import { useCallback, useEffect, useRef, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, Device, State, type Subscription } from 'react-native-ble-plx';

const SERVICE_UUID = '8c7a0001-6c3b-4f3d-a8d9-2adbc9f10211';
const TX_UUID = '8c7a0002-6c3b-4f3d-a8d9-2adbc9f10211';
const SCAN_DURATION_MS = 10_000;

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

  const managerRef = useRef<BleManager | null>(null);
  const deviceMapRef = useRef(new Map<string, Device>());
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const monitorSubscriptionRef = useRef<Subscription | null>(null);
  const disconnectSubscriptionRef = useRef<Subscription | null>(null);
  const onShotRef = useRef(onShot);

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

    try {
      const permitted = await requestBluetoothPermission();
      if (!permitted) {
        setError('Bluetooth permission is required to show nearby devices.');
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
        return;
      }

      await stopScan();
      deviceMapRef.current.clear();
      setDevices([]);
      setIsScanning(true);

      await manager.startDeviceScan(null, { allowDuplicates: false }, (scanError, device) => {
        if (scanError) {
          setError(scanError.message);
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
      await stopScan();
    }
  }, [stopScan]);

  const disconnect = useCallback(async () => {
    const manager = managerRef.current;
    const deviceId = connectedDevice?.id;

    monitorSubscriptionRef.current?.remove();
    monitorSubscriptionRef.current = null;
    disconnectSubscriptionRef.current?.remove();
    disconnectSubscriptionRef.current = null;
    setConnectedDevice(null);
    setConnectionState('idle');

    if (manager && deviceId) {
      await manager.cancelDeviceConnection(deviceId).catch(() => undefined);
    }
  }, [connectedDevice?.id]);

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

        setConnectionState('connecting');
        const connected = await device.connect({ timeout: 10_000 });
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

        monitorSubscriptionRef.current?.remove();
        monitorSubscriptionRef.current = ready.monitorCharacteristicForService(
          SERVICE_UUID,
          TX_UUID,
          (monitorError, characteristic) => {
            if (monitorError) {
              setError(monitorError.message);
              return;
            }

            const packet = parsePrecisionShotPacket(characteristic?.value ?? null);
            if (packet) onShotRef.current(packet);
          },
        );

        disconnectSubscriptionRef.current?.remove();
        disconnectSubscriptionRef.current = manager.onDeviceDisconnected(ready.id, (disconnectError) => {
          monitorSubscriptionRef.current?.remove();
          monitorSubscriptionRef.current = null;
          setConnectedDevice(null);
          setConnectionState('idle');

          if (disconnectError) setError(disconnectError.message);
        });

        setConnectedDevice(nextConnectedDevice);
        setConnectionState('connected');
      } catch (connectError) {
        setConnectionState('idle');
        setConnectedDevice(null);
        setError(
          `${getErrorMessage(connectError)} Make sure you selected the PrecisionShot target and try again.`,
        );
        await manager.cancelDeviceConnection(deviceId).catch(() => undefined);
      }
    },
    [connectedDevice, disconnect, stopScan],
  );

  return {
    adapterState,
    clearError: () => setError(null),
    connect,
    connectedDevice,
    connectionState,
    devices,
    disconnect,
    error,
    isScanning,
    scan,
  };
}
