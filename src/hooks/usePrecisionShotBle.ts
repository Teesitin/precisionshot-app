import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, PermissionsAndroid, Platform } from 'react-native';
import { BleManager, State, type Device, type Subscription } from 'react-native-ble-plx';
import {
    SERVICE_UUID,
    TX_UUID,
    RX_UUID,
    SnapshotReader,
    decodeAscii,
    encodeAscii,
    parseShot,
    type BoardState,
    type ShotPacket,
} from '@/lib/protocol';

export type BleDeviceOption = { id: string; name: string; rssi: number | null };
export type DiagnosticLog = { id: number; time: number; text: string };
type Pending = {
    id: number;
    timer: ReturnType<typeof setTimeout>;
    resolve: () => void;
    reject: (error: Error) => void;
    receivedState: boolean;
};

function message(error: unknown) {
    return error instanceof Error ? error.message : 'Bluetooth could not complete the request.';
}

async function requestPermission() {
    if (Platform.OS !== 'android') return Platform.OS === 'ios';
    if (Number(Platform.Version) < 31) {
        return (
            (await PermissionsAndroid.request(
                PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
            )) === 'granted'
        );
    }
    const permissions = [
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ];
    const result = await PermissionsAndroid.requestMultiple(permissions);
    return permissions.every((permission) => result[permission] === 'granted');
}

// The board owns the scores. This hook sends commands and listens for replies.
export function usePrecisionShotBle(debugZoneVisible = false) {
    const [appActive, setAppActive] = useState(AppState.currentState === 'active');
    const [devices, setDevices] = useState<BleDeviceOption[]>([]);
    const [connectedDevice, setConnectedDevice] = useState<BleDeviceOption | null>(null);
    const [connectionState, setConnectionState] = useState<'idle' | 'connecting' | 'connected'>(
        'idle',
    );
    const [adapterState, setAdapterState] = useState<State>(State.Unknown);
    const [isScanning, setIsScanning] = useState(false);
    const [isSynced, setIsSynced] = useState(false);
    const [pendingCommands, setPendingCommands] = useState(0);
    const [board, setBoard] = useState<BoardState | null>(null);
    const [lastShot, setLastShot] = useState<{ packet: ShotPacket; time: number } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [logs, setLogs] = useState<DiagnosticLog[]>([]);
    const [notifications, setNotifications] = useState(0);
    const managerRef = useRef<BleManager | null>(null);
    const deviceRef = useRef<Device | null>(null);
    const deviceMap = useRef(new Map<string, Device>());
    const monitorRef = useRef<Subscription | null>(null);
    const disconnectRef = useRef<Subscription | null>(null);
    const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reader = useRef(new SnapshotReader());
    const pending = useRef<Pending | null>(null);
    const queue = useRef<Promise<void>>(Promise.resolve());
    const generation = useRef(0);
    const requestId = useRef(0);
    const logId = useRef(0);
    const mounted = useRef(true);

    const log = useCallback((text: string) => {
        if (!mounted.current) return;
        const entry = { id: ++logId.current, time: Date.now(), text };
        setLogs((current) => [entry, ...current].slice(0, 60));
    }, []);

    const failPending = useCallback((reason: string) => {
        const active = pending.current;
        pending.current = null;
        if (active) {
            clearTimeout(active.timer);
            active.reject(new Error(reason));
        }
    }, []);

    const clearConnection = useCallback(() => {
        ++generation.current;
        monitorRef.current?.remove();
        disconnectRef.current?.remove();
        monitorRef.current = null;
        disconnectRef.current = null;
        deviceRef.current = null;
        reader.current.reset();
        failPending('The board disconnected.');
        if (mounted.current) {
            setConnectedDevice(null);
            setConnectionState('idle');
            setIsSynced(false);
            setBoard(null);
            setLastShot(null);
        }
    }, [failPending]);

    useEffect(() => {
        mounted.current = true;
        if (Platform.OS === 'web') return;
        let manager: BleManager;
        try {
            manager = new BleManager();
            managerRef.current = manager;
        } catch {
            setError('Install the Android app to use Bluetooth.');
            return;
        }
        const subscription = manager.onStateChange(setAdapterState, true);
        return () => {
            mounted.current = false;
            if (scanTimer.current) clearTimeout(scanTimer.current);
            clearConnection();
            subscription.remove();
            void manager.stopDeviceScan().catch(() => undefined);
            void manager.destroy().catch(() => undefined);
            managerRef.current = null;
        };
    }, [clearConnection]);

    const stopScan = useCallback(async () => {
        if (scanTimer.current) clearTimeout(scanTimer.current);
        scanTimer.current = null;
        setIsScanning(false);
        await managerRef.current?.stopDeviceScan().catch(() => undefined);
    }, []);

    const scan = useCallback(async () => {
        setError(null);
        try {
            if (Platform.OS === 'web')
                throw new Error('Use the installed phone app to connect over Bluetooth.');
            if (!(await requestPermission()))
                throw new Error('Allow Bluetooth permission to find your board.');
            const manager = managerRef.current;
            if (!manager || (await manager.state()) !== State.PoweredOn)
                throw new Error('Turn on Bluetooth and scan again.');
            await stopScan();
            deviceMap.current.clear();
            setDevices([]);
            setIsScanning(true);
            log('Scanning for PrecisionShot');
            await manager.startDeviceScan(
                [SERVICE_UUID],
                { allowDuplicates: false },
                (scanError, device) => {
                    if (scanError) {
                        setError(scanError.message);
                        void stopScan();
                        return;
                    }
                    if (!device || !mounted.current) return;
                    deviceMap.current.set(device.id, device);
                    const option = {
                        id: device.id,
                        name: device.name ?? device.localName ?? 'PrecisionShot',
                        rssi: device.rssi,
                    };
                    setDevices((current) => [
                        ...current.filter((item) => item.id !== device.id),
                        option,
                    ]);
                },
            );
            scanTimer.current = setTimeout(() => void stopScan(), 10000);
        } catch (scanError) {
            setError(message(scanError));
            await stopScan();
        }
    }, [log, stopScan]);

    // Send one request at a time and wait for the board's matching ACK.
    const sendCommand = useCallback(
        (command: string) => {
            const epoch = generation.current;
            setPendingCommands((count) => count + 1);
            const task = queue.current
                .catch(() => undefined)
                .then(async () => {
                    const device = deviceRef.current;
                    if (!device || epoch !== generation.current)
                        throw new Error('Connect to PrecisionShot first.');
                    const id = (requestId.current = (requestId.current % 999) + 1);
                    const text = `@${id}:${command}`;
                    if (text.length > 20 || !/^[\x20-\x7e]+$/.test(text))
                        throw new Error('Invalid board command.');
                    log(`TX ${text}`);
                    await new Promise<void>((resolve, reject) => {
                        const timer = setTimeout(() => {
                            if (pending.current?.id === id) {
                                pending.current = null;
                                reject(
                                    new Error(
                                        'The board did not confirm the action. Use Sync board in Settings.',
                                    ),
                                );
                            }
                        }, 5000);
                        pending.current = { id, timer, resolve, reject, receivedState: false };
                        void device
                            .writeCharacteristicWithResponseForService(
                                SERVICE_UUID,
                                RX_UUID,
                                encodeAscii(text),
                            )
                            .catch((writeError) => {
                                if (epoch === generation.current && pending.current?.id === id)
                                    failPending(message(writeError));
                            });
                    });
                });
            queue.current = task;
            return task
                .catch((commandError) => {
                    if (mounted.current && epoch === generation.current) {
                        setError(message(commandError));
                        setIsSynced(false);
                        log(message(commandError));
                    }
                    throw commandError;
                })
                .finally(() => {
                    if (mounted.current) setPendingCommands((count) => Math.max(0, count - 1));
                });
        },
        [failPending, log],
    );

    const disconnect = useCallback(async () => {
        const device = deviceRef.current;
        clearConnection();
        await device?.cancelConnection().catch(() => undefined);
        log('Disconnected');
    }, [clearConnection, log]);

    const connect = useCallback(
        async (id: string) => {
            if (connectionState === 'connecting') return;
            setError(null);
            await stopScan();
            await disconnect();
            const epoch = generation.current;
            let connected: Device | null = null;
            try {
                const device = deviceMap.current.get(id);
                if (!device) throw new Error('Scan again to find the board.');
                setConnectionState('connecting');
                connected = await device.connect({ timeout: 10000 });
                const ready = await connected.discoverAllServicesAndCharacteristics();
                if (epoch !== generation.current) throw new Error('Connection cancelled.');
                const characteristics = await ready.characteristicsForService(SERVICE_UUID);
                if (
                    !characteristics.some(
                        (item) => item.uuid.toLowerCase() === TX_UUID && item.isNotifiable,
                    ) ||
                    !characteristics.some(
                        (item) =>
                            item.uuid.toLowerCase() === RX_UUID && item.isWritableWithResponse,
                    )
                ) {
                    throw new Error('This board does not provide the required Bluetooth controls.');
                }
                deviceRef.current = ready;
                reader.current.reset();
                setLogs([]);
                setNotifications(0);
                monitorRef.current = ready.monitorCharacteristicForService(
                    SERVICE_UUID,
                    TX_UUID,
                    (monitorError, characteristic) => {
                        if (epoch !== generation.current || !mounted.current) return;
                        if (monitorError) {
                            setError(monitorError.message);
                            setIsSynced(false);
                            failPending(monitorError.message);
                            return;
                        }
                        if (!characteristic?.value) return;
                        try {
                            const text = decodeAscii(characteristic.value);
                            log(`RX ${text}`);
                            setNotifications((count) => count + 1);
                            const state = reader.current.push(text);
                            if (state) {
                                setBoard(state);
                                setIsSynced(true);
                                if (state.lastScore === null) setLastShot(null);
                                if (pending.current) pending.current.receivedState = true;
                            }
                            const shot = parseShot(text);
                            if (shot) setLastShot({ packet: shot, time: Date.now() });
                            const ack = /^ACK:(\d+)$/.exec(text);
                            const rejection = /^ERR:(\d+):(.+)$/.exec(text);
                            const active = pending.current;
                            if (
                                active &&
                                ack &&
                                Number(ack[1]) === active.id &&
                                active.receivedState
                            ) {
                                clearTimeout(active.timer);
                                pending.current = null;
                                active.resolve();
                            } else if (active && rejection && Number(rejection[1]) === active.id) {
                                failPending(`Board rejected the action: ${rejection[2]}`);
                            }
                        } catch (parseError) {
                            log(message(parseError));
                        }
                    },
                );
                disconnectRef.current = managerRef.current!.onDeviceDisconnected(ready.id, () => {
                    if (epoch !== generation.current) return;
                    clearConnection();
                    log('Board disconnected');
                });
                setConnectedDevice({
                    id: ready.id,
                    name: ready.name ?? 'PrecisionShot',
                    rssi: ready.rssi,
                });
                setConnectionState('connected');
                // Give the notification subscription time to reach the board.
                await new Promise((resolve) => setTimeout(resolve, 200));
                await sendCommand('STATE');
                log('Board state synchronized');
            } catch (connectError) {
                if (epoch === generation.current) {
                    clearConnection();
                    setError(message(connectError));
                }
                await connected?.cancelConnection().catch(() => undefined);
            }
        },
        [clearConnection, connectionState, disconnect, failPending, log, sendCommand, stopScan],
    );

    useEffect(() => {
        const subscription = AppState.addEventListener('change', (state) => {
            setAppActive(state === 'active');
        });
        return () => subscription.remove();
    }, []);

    useEffect(() => {
        if (connectionState !== 'connected' || !isSynced) return;
        const watching = debugZoneVisible && appActive;
        // Opening, closing, or backgrounding the panel changes the board subscription.
        const update = () =>
            void sendCommand(watching ? 'WATCH:1' : 'WATCH:0').catch(() => undefined);
        update();
        const timer = watching ? setInterval(update, 5000) : null;
        return () => {
            if (timer) clearInterval(timer);
        };
    }, [appActive, connectionState, debugZoneVisible, isSynced, sendCommand]);

    return {
        devices,
        connectedDevice,
        connectionState,
        adapterState,
        isScanning,
        isSynced,
        busy: pendingCommands > 0,
        board,
        lastShot,
        error,
        logs,
        notifications,
        scan,
        stopScan,
        connect,
        disconnect,
        sendCommand,
        clearError: () => setError(null),
        clearLogs: () => setLogs([]),
    };
}
