import { useCallback, useEffect, useRef, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, Device, State, type Subscription } from 'react-native-ble-plx';

const SERVICE_UUID = '8c7a0001-6c3b-4f3d-a8d9-2adbc9f10211';
const TX_UUID = '8c7a0002-6c3b-4f3d-a8d9-2adbc9f10211';
const SCAN_DURATION_MS = 10_000;
const RSSI_POLL_INTERVAL_MS = 5_000;
const MAX_DIAGNOSTIC_LOGS = 60;

export type PrecisionShotPacket = {
  hit: number;
  score: number;
  x?: number;
  y?: number;
};

export type BleDeviceOption = {
  id: string;
  name: string;
  rssi: number | null;
};

export type BleDiagnosticLog = {
  id: number;
  timestamp: number;
  level: 'info' | 'data' | 'warning' | 'error';
  message: string;
  detail?: string;
};

export type BleDiagnostics = {
  bytesReceived: number;
  characteristicCount: number;
  connectedAt: number | null;
  diagnosticMessages: number;
  lastBase64Value: string | null;
  lastPacketAt: number | null;
  lastRawValue: string | null;
  logs: BleDiagnosticLog[];
  malformedPackets: number;
  mtu: number | null;
  notificationsReceived: number;
  packetsLastMinute: number;
  rssi: number | null;
  servicesDiscovered: number;
  shotPackets: number;
};

type ConnectionState = 'idle' | 'connecting' | 'connected';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'An unexpected Bluetooth error occurred.';
}

function decodeBase64Ascii(value: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  let buffer = 0;
  let bitsInBuffer = 0;

  for (const character of value) {
    if (character === '=') break;

    const sixBits = alphabet.indexOf(character);
    if (sixBits < 0) continue;

    buffer = (buffer << 6) | sixBits;
    bitsInBuffer += 6;

    if (bitsInBuffer >= 8) {
      bitsInBuffer -= 8;
      result += String.fromCharCode((buffer >> bitsInBuffer) & 0xff);
    }
  }

  return result;
}

function createEmptyDiagnostics(): BleDiagnostics {
  return {
    bytesReceived: 0,
    characteristicCount: 0,
    connectedAt: null,
    diagnosticMessages: 0,
    lastBase64Value: null,
    lastPacketAt: null,
    lastRawValue: null,
    logs: [],
    malformedPackets: 0,
    mtu: null,
    notificationsReceived: 0,
    packetsLastMinute: 0,
    rssi: null,
    servicesDiscovered: 0,
    shotPackets: 0,
  };
}

function formatLogDetail(value: string) {
  const printable = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, (character) => {
    const code = character.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0');
    return `\\x${code}`;
  });

  return printable || '(empty payload)';
}

function parsePrecisionShotPacket(value: string | null): PrecisionShotPacket | null {
  if (!value) return null;

  try {
    const packet = JSON.parse(decodeBase64Ascii(value)) as Partial<PrecisionShotPacket>;

    if (typeof packet.hit !== 'number' || typeof packet.score !== 'number') {
      return null;
    }

    return {
      hit: packet.hit,
      score: packet.score,
      x: typeof packet.x === 'number' ? packet.x : undefined,
      y: typeof packet.y === 'number' ? packet.y : undefined,
    };
  } catch {
    // Messages such as READY and PONG are valid diagnostics, but not shot data.
    return null;
  }
}

async function requestBluetoothPermission() {
  if (Platform.OS !== 'android') return Platform.OS === 'ios';

  const apiLevel = Number(Platform.Version);

  if (apiLevel >= 31) {
    const result = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ]);

    return (
      result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] === PermissionsAndroid.RESULTS.GRANTED &&
      result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === PermissionsAndroid.RESULTS.GRANTED
    );
  }

  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

export function usePrecisionShotBle(onShot: (packet: PrecisionShotPacket) => void) {
  const [devices, setDevices] = useState<BleDeviceOption[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<BleDeviceOption | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [adapterState, setAdapterState] = useState<State>(State.Unknown);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<BleDiagnostics>(createEmptyDiagnostics);

  const managerRef = useRef<BleManager | null>(null);
  const deviceMapRef = useRef(new Map<string, Device>());
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const monitorSubscriptionRef = useRef<Subscription | null>(null);
  const disconnectSubscriptionRef = useRef<Subscription | null>(null);
  const rssiTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const packetTimesRef = useRef<number[]>([]);
  const diagnosticLogIdRef = useRef(0);
  const onShotRef = useRef(onShot);

  const addDiagnosticLog = useCallback(
    (level: BleDiagnosticLog['level'], message: string, detail?: string) => {
      const entry: BleDiagnosticLog = {
        id: ++diagnosticLogIdRef.current,
        timestamp: Date.now(),
        level,
        message,
        detail,
      };

      setDiagnostics((current) => ({
        ...current,
        logs: [entry, ...current.logs].slice(0, MAX_DIAGNOSTIC_LOGS),
      }));
    },
    [],
  );

  useEffect(() => {
    onShotRef.current = onShot;
  }, [onShot]);

  useEffect(() => {
    if (Platform.OS === 'web') {
      setError('Bluetooth scanning is available in an installed Android or iOS build.');
      return;
    }

    let manager: BleManager;

    try {
      manager = new BleManager();
      managerRef.current = manager;
    } catch {
      setError('Bluetooth requires a development or production build; it is not available in Expo Go.');
      return;
    }

    const stateSubscription = manager.onStateChange(setAdapterState, true);

    return () => {
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
      if (rssiTimerRef.current) clearInterval(rssiTimerRef.current);
      monitorSubscriptionRef.current?.remove();
      disconnectSubscriptionRef.current?.remove();
      stateSubscription.remove();
      void manager.stopDeviceScan().catch(() => undefined);
      void manager.destroy().catch(() => undefined);
      managerRef.current = null;
    };
  }, []);

  const stopScan = useCallback(async () => {
    if (scanTimerRef.current) {
      clearTimeout(scanTimerRef.current);
      scanTimerRef.current = null;
    }

    setIsScanning(false);

    if (managerRef.current) {
      await managerRef.current.stopDeviceScan().catch(() => undefined);
    }
  }, []);

  const scan = useCallback(async () => {
    setError(null);
    addDiagnosticLog('info', 'Bluetooth scan requested');

    try {
      const permitted = await requestBluetoothPermission();
      if (!permitted) {
        setError('Bluetooth permission is required to show nearby devices.');
        addDiagnosticLog('warning', 'Bluetooth permission denied');
        return;
      }

      const manager = managerRef.current;
      if (!manager) {
        setError('Bluetooth is unavailable in this build.');
        return;
      }

      const currentState = await manager.state();
      setAdapterState(currentState);

      if (currentState !== State.PoweredOn) {
        setError('Turn on Bluetooth, then try scanning again.');
        addDiagnosticLog('warning', `Bluetooth adapter is ${currentState}`);
        return;
      }

      await stopScan();
      deviceMapRef.current.clear();
      setDevices([]);
      setIsScanning(true);
      addDiagnosticLog('info', 'Scanning for nearby BLE devices');

      await manager.startDeviceScan(null, { allowDuplicates: false }, (scanError, device) => {
        if (scanError) {
          setError(scanError.message);
          addDiagnosticLog('error', 'BLE scan failed', scanError.message);
          void stopScan();
          return;
        }

        if (!device) return;

        deviceMapRef.current.set(device.id, device);
        const nextDevice: BleDeviceOption = {
          id: device.id,
          name: device.name ?? device.localName ?? 'Unnamed BLE device',
          rssi: device.rssi,
        };

        setDevices((currentDevices) => {
          const nextDevices = currentDevices.filter((item) => item.id !== nextDevice.id);
          nextDevices.push(nextDevice);

          return nextDevices.sort((left, right) => {
            if (left.name === 'PrecisionShot') return -1;
            if (right.name === 'PrecisionShot') return 1;
            return (right.rssi ?? -999) - (left.rssi ?? -999);
          });
        });
      });

      scanTimerRef.current = setTimeout(() => {
        void stopScan();
      }, SCAN_DURATION_MS);
    } catch (scanError) {
      setError(getErrorMessage(scanError));
      addDiagnosticLog('error', 'BLE scan failed', getErrorMessage(scanError));
      await stopScan();
    }
  }, [addDiagnosticLog, stopScan]);

  const disconnect = useCallback(async () => {
    const manager = managerRef.current;
    const deviceId = connectedDevice?.id;

    monitorSubscriptionRef.current?.remove();
    monitorSubscriptionRef.current = null;
    disconnectSubscriptionRef.current?.remove();
    disconnectSubscriptionRef.current = null;
    if (rssiTimerRef.current) clearInterval(rssiTimerRef.current);
    rssiTimerRef.current = null;
    setConnectedDevice(null);
    setConnectionState('idle');
    addDiagnosticLog('info', 'Disconnect requested by user');

    if (manager && deviceId) {
      await manager.cancelDeviceConnection(deviceId).catch(() => undefined);
    }
  }, [addDiagnosticLog, connectedDevice?.id]);

  const connect = useCallback(
    async (deviceId: string) => {
      setError(null);
      await stopScan();

      const manager = managerRef.current;
      const device = deviceMapRef.current.get(deviceId);

      if (!manager || !device) {
        setError('That device is no longer available. Scan again and retry.');
        return;
      }

      try {
        if (connectedDevice && connectedDevice.id !== deviceId) {
          await disconnect();
        }

        packetTimesRef.current = [];
        setDiagnostics(createEmptyDiagnostics());
        setConnectionState('connecting');
        addDiagnosticLog('info', 'Opening BLE connection', device.name ?? deviceId);
        const connected = await device.connect({ timeout: 10_000 });
        addDiagnosticLog('info', 'BLE link established; discovering services');
        const ready = await connected.discoverAllServicesAndCharacteristics();
        const services = await ready.services();

        if (!services.some((service) => service.uuid.toLowerCase() === SERVICE_UUID)) {
          throw new Error('This device does not provide the PrecisionShot Bluetooth service.');
        }

        const nextConnectedDevice: BleDeviceOption = {
          id: ready.id,
          name: ready.name ?? ready.localName ?? 'Unnamed BLE device',
          rssi: ready.rssi,
        };

        const characteristics = await ready.characteristicsForService(SERVICE_UUID);
        const txCharacteristic = characteristics.find(
          (characteristic) => characteristic.uuid.toLowerCase() === TX_UUID,
        );

        if (!txCharacteristic?.isNotifiable && !txCharacteristic?.isIndicatable) {
          throw new Error('The PrecisionShot transmit characteristic cannot send notifications.');
        }

        const connectedAt = Date.now();
        setDiagnostics((current) => ({
          ...current,
          characteristicCount: characteristics.length,
          connectedAt,
          mtu: ready.mtu ?? null,
          rssi: ready.rssi,
          servicesDiscovered: services.length,
        }));
        addDiagnosticLog(
          'info',
          'Service discovery complete',
          `${services.length} services, ${characteristics.length} PrecisionShot characteristics, MTU ${ready.mtu}`,
        );

        monitorSubscriptionRef.current?.remove();
        monitorSubscriptionRef.current = ready.monitorCharacteristicForService(
          SERVICE_UUID,
          TX_UUID,
          (monitorError, characteristic) => {
            if (monitorError) {
              setError(monitorError.message);
              addDiagnosticLog('error', 'Notification monitor error', monitorError.message);
              return;
            }

            const base64Value = characteristic?.value ?? null;
            const rawValue = base64Value ? decodeBase64Ascii(base64Value) : '';
            const packet = parsePrecisionShotPacket(base64Value);
            const receivedAt = Date.now();
            const isDiagnosticMessage =
              !packet &&
              rawValue.length > 0 &&
              /^[\x09\x0A\x0D\x20-\x7E]+$/.test(rawValue) &&
              !rawValue.trim().startsWith('{');

            packetTimesRef.current = [...packetTimesRef.current, receivedAt].filter(
              (timestamp) => receivedAt - timestamp <= 60_000,
            );

            const entry: BleDiagnosticLog = {
              id: ++diagnosticLogIdRef.current,
              timestamp: receivedAt,
              level: packet ? 'data' : isDiagnosticMessage ? 'info' : 'warning',
              message: packet
                ? `Shot packet: hit ${packet.hit}, score ${packet.score}`
                : isDiagnosticMessage
                  ? 'Device diagnostic message'
                  : 'Unrecognized packet',
              detail: formatLogDetail(rawValue),
            };

            setDiagnostics((current) => ({
              ...current,
              bytesReceived: current.bytesReceived + rawValue.length,
              diagnosticMessages: current.diagnosticMessages + (isDiagnosticMessage ? 1 : 0),
              lastBase64Value: base64Value,
              lastPacketAt: receivedAt,
              lastRawValue: formatLogDetail(rawValue),
              logs: [entry, ...current.logs].slice(0, MAX_DIAGNOSTIC_LOGS),
              malformedPackets: current.malformedPackets + (!packet && !isDiagnosticMessage ? 1 : 0),
              notificationsReceived: current.notificationsReceived + 1,
              packetsLastMinute: packetTimesRef.current.length,
              shotPackets: current.shotPackets + (packet ? 1 : 0),
            }));

            if (packet) onShotRef.current(packet);
          },
        );
        addDiagnosticLog('info', 'Subscribed to PrecisionShot notifications', TX_UUID);

        disconnectSubscriptionRef.current?.remove();
        disconnectSubscriptionRef.current = manager.onDeviceDisconnected(ready.id, (disconnectError) => {
          monitorSubscriptionRef.current?.remove();
          monitorSubscriptionRef.current = null;
          if (rssiTimerRef.current) clearInterval(rssiTimerRef.current);
          rssiTimerRef.current = null;
          setConnectedDevice(null);
          setConnectionState('idle');

          if (disconnectError) {
            setError(disconnectError.message);
            addDiagnosticLog('error', 'Device disconnected unexpectedly', disconnectError.message);
          } else {
            addDiagnosticLog('warning', 'Device disconnected');
          }
        });

        setConnectedDevice(nextConnectedDevice);
        setConnectionState('connected');
        addDiagnosticLog('info', 'PrecisionShot is ready and listening');

        const refreshRssi = async () => {
          try {
            const refreshedDevice = await ready.readRSSI();
            const refreshedAt = Date.now();
            packetTimesRef.current = packetTimesRef.current.filter(
              (timestamp) => refreshedAt - timestamp <= 60_000,
            );
            setConnectedDevice((current) =>
              current?.id === refreshedDevice.id ? { ...current, rssi: refreshedDevice.rssi } : current,
            );
            setDiagnostics((current) => ({
              ...current,
              packetsLastMinute: packetTimesRef.current.length,
              rssi: refreshedDevice.rssi,
            }));
          } catch (rssiError) {
            addDiagnosticLog('warning', 'Could not refresh signal strength', getErrorMessage(rssiError));
          }
        };

        void refreshRssi();
        if (rssiTimerRef.current) clearInterval(rssiTimerRef.current);
        rssiTimerRef.current = setInterval(() => void refreshRssi(), RSSI_POLL_INTERVAL_MS);
      } catch (connectError) {
        setConnectionState('idle');
        setConnectedDevice(null);
        setError(
          `${getErrorMessage(connectError)} Make sure you selected the PrecisionShot target and try again.`,
        );
        addDiagnosticLog('error', 'Connection failed', getErrorMessage(connectError));
        await manager.cancelDeviceConnection(deviceId).catch(() => undefined);
      }
    },
    [addDiagnosticLog, connectedDevice, disconnect, stopScan],
  );

  return {
    adapterState,
    bleServiceUuid: SERVICE_UUID,
    bleTxUuid: TX_UUID,
    clearError: () => setError(null),
    connect,
    connectedDevice,
    connectionState,
    diagnostics,
    devices,
    disconnect,
    error,
    isScanning,
    scan,
    clearDiagnosticLogs: () => setDiagnostics((current) => ({ ...current, logs: [] })),
  };
}
