import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  type BleDiagnostics,
  type PrecisionShotPacket,
  usePrecisionShotBle,
} from '@/hooks/usePrecisionShotBle';

type Unit = 'cm' | 'in';

type TransistorHit = {
  row: number;
  col: number;
  index: number;
  displayNumber: number;
  debugHex: string;
  debugBinary: string;
};

type Shot = {
  id: number;
  x: number;
  y: number;
  distancePx: number;
  score: number;
  time: string;
  transistor: TransistorHit;
};

const accent = '#ecd316';

const targetSize = 220;
const targetRadius = targetSize / 2;
const simulatedRadiusPx = 100;

const targetDiameterIn = 12;
const targetRadiusIn = targetDiameterIn / 2;
const pxToIn = targetRadiusIn / simulatedRadiusPx;
const pxToCm = pxToIn * 2.54;

const transistorGridSize = 20;
const totalTransistors = transistorGridSize * transistorGridSize;

const historyPageSize = 5;

function formatElapsed(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatBytes(bytes: number) {
  if (bytes < 1_024) return `${bytes} B`;
  return `${(bytes / 1_024).toFixed(1)} KB`;
}

function getSignalQuality(rssi: number | null) {
  if (rssi === null) return { label: 'Measuring', color: '#94a3b8' };
  if (rssi >= -55) return { label: 'Excellent', color: '#22c55e' };
  if (rssi >= -67) return { label: 'Good', color: '#84cc16' };
  if (rssi >= -75) return { label: 'Fair', color: '#f59e0b' };
  return { label: 'Weak', color: '#ef4444' };
}

const getTransistorHit = (x: number, y: number): TransistorHit => {
  const normalizedX = (x + simulatedRadiusPx) / (simulatedRadiusPx * 2);
  const normalizedY = (y + simulatedRadiusPx) / (simulatedRadiusPx * 2);

  const col = Math.min(
    transistorGridSize - 1,
    Math.max(0, Math.round(normalizedX * (transistorGridSize - 1))),
  );
  const row = Math.min(
    transistorGridSize - 1,
    Math.max(0, Math.round(normalizedY * (transistorGridSize - 1))),
  );

  const index = row * transistorGridSize + col;

  return {
    row,
    col,
    index,
    displayNumber: index + 1,
    debugHex: `0x${index.toString(16).toUpperCase().padStart(4, '0')}`,
    debugBinary: `0b${index.toString(2).padStart(16, '0')}`,
  };
};

type ShotInput = {
  score?: number;
  x?: number;
  y?: number;
};

export default function HomeScreen() {
  const [isDark, setIsDark] = useState(true);
  const [unit, setUnit] = useState<Unit>('cm');
  const [shots, setShots] = useState<Shot[]>([]);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [historyPage, setHistoryPage] = useState(0);
  const [diagnosticClock, setDiagnosticClock] = useState(Date.now());

  const theme = isDark ? darkTheme : lightTheme;

  const convertDistance = (distancePx: number) => {
    const value = unit === 'cm' ? distancePx * pxToCm : distancePx * pxToIn;
    return value.toFixed(1);
  };

  const unitLabel = unit === 'cm' ? 'cm' : 'in';

  const stats = useMemo(() => {
    const totalShots = shots.length;
    const totalScore = shots.reduce((sum, shot) => sum + shot.score, 0);
    const totalDistancePx = shots.reduce((sum, shot) => sum + shot.distancePx, 0);
    const avgDistancePx = totalShots ? totalDistancePx / totalShots : 0;

    return {
      totalShots,
      avgScore: totalShots ? (totalScore / totalShots).toFixed(1) : '0.0',
      bestScore: totalShots ? Math.max(...shots.map((shot) => shot.score)) : 0,
      avgDistancePx,
      lastShot: shots[0],
    };
  }, [shots]);

  const recordShot = useCallback((input: ShotInput = {}) => {
    const angle = Math.random() * Math.PI * 2;
    const incomingScore =
      typeof input.score === 'number' ? Math.min(10, Math.max(0, Math.round(input.score))) : undefined;
    const hasIncomingCoordinates = typeof input.x === 'number' && typeof input.y === 'number';

    let radius = Math.sqrt(Math.random()) * simulatedRadiusPx;
    if (incomingScore !== undefined && !hasIncomingCoordinates) {
      const minimumRadius = Math.min(simulatedRadiusPx, (10 - incomingScore) * 10);
      const maximumRadius = Math.min(simulatedRadiusPx, minimumRadius + 9);
      radius = minimumRadius + Math.random() * (maximumRadius - minimumRadius);
    }

    const x = Math.round(hasIncomingCoordinates ? input.x! : Math.cos(angle) * radius);
    const y = Math.round(hasIncomingCoordinates ? input.y! : Math.sin(angle) * radius);
    const distancePx = Math.round(Math.sqrt(x * x + y * y));
    const score = incomingScore ?? Math.max(0, 10 - Math.floor(distancePx / 10));
    const transistor = getTransistorHit(x, y);

    const newShot: Shot = {
      id: Date.now(),
      x,
      y,
      distancePx,
      score,
      transistor,
      time: new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    };

    setShots((currentShots) => [newShot, ...currentShots]);
    setHistoryPage(0);
  }, []);

  const simulateShot = () => recordShot();

  const handleBluetoothShot = useCallback(
    (packet: PrecisionShotPacket) => {
      recordShot({ score: packet.score, x: packet.x, y: packet.y });
    },
    [recordShot],
  );

  const {
    adapterState,
    bleServiceUuid,
    bleTxUuid,
    clearDiagnosticLogs,
    connect,
    connectedDevice,
    connectionState,
    diagnostics,
    devices,
    disconnect,
    error: bluetoothError,
    isScanning,
    scan,
  } = usePrecisionShotBle(handleBluetoothShot);

  useEffect(() => {
    if (!connectedDevice) return;

    setDiagnosticClock(Date.now());
    const timer = setInterval(() => setDiagnosticClock(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [connectedDevice]);

  const resetShots = () => {
    setShots([]);
    setHistoryPage(0);
  };

  const totalHistoryPages = Math.max(1, Math.ceil(shots.length / historyPageSize));
  const visibleShots = shots.slice(historyPage * historyPageSize, historyPage * historyPageSize + historyPageSize);

  const lastShotLeft = stats.lastShot ? targetRadius + stats.lastShot.x - 6 : 0;
  const lastShotTop = stats.lastShot ? targetRadius + stats.lastShot.y - 6 : 0;

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <ScrollView
        style={[styles.scrollView, { backgroundColor: theme.background }]}
        contentContainerStyle={[styles.content, { backgroundColor: theme.background }]}
        bounces={false}
        overScrollMode="never"
      >
        <View style={styles.header}>
          <Text style={[styles.eyebrow, { color: accent }]}>PrecisionShot</Text>
          <Text style={[styles.title, { color: theme.text }]}>Classic Mode Demo</Text>
          <Text style={[styles.subtitle, { color: theme.muted }]}>
            Simulate laser shots, track accuracy, and preview the mobile training dashboard.
          </Text>
        </View>

        <View style={[styles.targetCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[styles.cardTitle, { color: theme.text }]}>Target Preview</Text>

          <View style={[styles.target, { borderColor: theme.border }]}>
            <View style={[styles.ring, styles.ringOuter]} />
            <View style={[styles.ring, styles.ringMiddle]} />
            <View style={[styles.ring, styles.ringInner]} />
            <View style={[styles.bullseye, { backgroundColor: accent }]} />

            {stats.lastShot && (
              <View style={[styles.shotDot, { left: lastShotLeft, top: lastShotTop, backgroundColor: accent }]} />
            )}
          </View>

          <Text style={[styles.targetNote, { color: theme.muted }]}>
            Simulated target diameter: {targetDiameterIn} in / {(targetDiameterIn * 2.54).toFixed(1)} cm
          </Text>

          <View style={styles.buttonRow}>
            <Pressable style={styles.primaryButton} onPress={simulateShot}>
              <Text style={styles.primaryButtonText}>Simulate Shot</Text>
            </Pressable>

            <Pressable style={[styles.secondaryButton, { borderColor: theme.border }]} onPress={resetShots}>
              <Text style={[styles.secondaryButtonText, { color: theme.text }]}>Reset</Text>
            </Pressable>
          </View>
        </View>

        <View style={[styles.dashboardCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[styles.cardTitle, { color: theme.text }]}>Latest Shot</Text>

          {stats.lastShot ? (
            <>
              <View style={styles.latestShotHero}>
                <View>
                  <Text style={[styles.detailLabel, { color: theme.muted }]}>Score</Text>
                  <Text style={[styles.bigDetailValue, { color: theme.text }]}>{stats.lastShot.score}/10</Text>
                </View>

                <View style={styles.latestShotRight}>
                  <Text style={[styles.detailLabel, { color: theme.muted }]}>From Center</Text>
                  <Text style={[styles.bigDetailValue, { color: theme.text }]}>
                    {convertDistance(stats.lastShot.distancePx)} {unitLabel}
                  </Text>
                </View>
              </View>

              <View style={styles.latestShotGrid}>
                <DetailBlock label="X Coordinate" value={String(stats.lastShot.x)} theme={theme} />
                <DetailBlock label="Y Coordinate" value={String(stats.lastShot.y)} theme={theme} />
                <DetailBlock label="Shot Time" value={stats.lastShot.time} theme={theme} />
              </View>

              <View style={[styles.debugPanel, { backgroundColor: theme.debugBackground, borderColor: theme.border }]}>
                <Text style={[styles.debugTitle, { color: accent }]}>Transistor Debug</Text>

                <View style={styles.debugGrid}>
                  <DetailBlock label="Grid Size" value={`${totalTransistors} total`} theme={theme} />
                  <DetailBlock label="Hit Sensor" value={`T${stats.lastShot.transistor.displayNumber}`} theme={theme} />
                  <DetailBlock label="Row / Col" value={`${stats.lastShot.transistor.row}, ${stats.lastShot.transistor.col}`} theme={theme} />
                  <DetailBlock label="Array Index" value={String(stats.lastShot.transistor.index)} theme={theme} />
                  <DetailBlock label="Debug Hex" value={stats.lastShot.transistor.debugHex} theme={theme} />
                  <DetailBlock label="Bit Number" value={`bit ${stats.lastShot.transistor.debugBinary}`} theme={theme} />
                </View>
              </View>
            </>
          ) : (
            <Text style={[styles.emptyText, { color: theme.muted }]}>No shots yet. Tap “Simulate Shot” to begin.</Text>
          )}
        </View>

        <View style={styles.statsGrid}>
          <StatCard label="Shots Taken" value={String(stats.totalShots)} theme={theme} />
          <StatCard label="Average Score" value={stats.avgScore} theme={theme} />
          <StatCard label="Best Score" value={String(stats.bestScore)} theme={theme} />
          <StatCard label="Avg. Distance" value={`${convertDistance(stats.avgDistancePx)} ${unitLabel}`} theme={theme} />
        </View>

        <View style={[styles.dashboardCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <View style={styles.cardHeaderRow}>
            <Text style={[styles.cardTitle, { color: theme.text }]}>Shot History</Text>

            {shots.length > 0 && (
              <Text style={[styles.pageText, { color: theme.muted }]}>
                Page {historyPage + 1} / {totalHistoryPages}
              </Text>
            )}
          </View>

          {shots.length === 0 ? (
            <Text style={[styles.emptyText, { color: theme.muted }]}>Shot history will appear here.</Text>
          ) : (
            <>
              {visibleShots.map((shot, index) => (
                <View key={shot.id} style={[styles.historyRow, { borderColor: theme.border }]}>
                  <Text style={[styles.historyIndex, { color: accent }]}>#{historyPage * historyPageSize + index + 1}</Text>

                  <View style={styles.historyInfo}>
                    <Text style={[styles.historyTitle, { color: theme.text }]}>
                      T{shot.transistor.displayNumber} • X: {shot.x} | Y: {shot.y}
                    </Text>
                    <Text style={[styles.historyMeta, { color: theme.muted }]}>
                      Score {shot.score}/10 • {convertDistance(shot.distancePx)} {unitLabel} from center • {shot.transistor.debugHex} • bit {shot.transistor.debugBinary}
                    </Text>
                  </View>
                </View>
              ))}

              <View style={styles.paginationRow}>
                <Pressable
                  style={[styles.pageButton, { borderColor: theme.border }, historyPage === 0 && styles.disabledButton]}
                  disabled={historyPage === 0}
                  onPress={() => setHistoryPage((page) => Math.max(0, page - 1))}
                >
                  <Text style={[styles.pageButtonText, { color: theme.text }]}>Newest</Text>
                </Pressable>

                <Pressable
                  style={[styles.pageButton, { borderColor: theme.border }, historyPage >= totalHistoryPages - 1 && styles.disabledButton]}
                  disabled={historyPage >= totalHistoryPages - 1}
                  onPress={() => setHistoryPage((page) => Math.min(totalHistoryPages - 1, page + 1))}
                >
                  <Text style={[styles.pageButtonText, { color: theme.text }]}>Older</Text>
                </Pressable>
              </View>
            </>
          )}
        </View>

        {connectedDevice && (
          <BluetoothDiagnosticsPanel
            adapterState={adapterState}
            characteristicUuid={bleTxUuid}
            clearLogs={clearDiagnosticLogs}
            device={connectedDevice}
            diagnostics={diagnostics}
            now={diagnosticClock}
            serviceUuid={bleServiceUuid}
            theme={theme}
          />
        )}
      </ScrollView>

      {isMenuOpen && (
        <View style={[styles.menuPanel, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[styles.menuTitle, { color: theme.text }]}>Settings</Text>

          <ScrollView
            style={styles.menuScroll}
            contentContainerStyle={styles.menuScrollContent}
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.menuSection}>
              <Text style={[styles.menuLabel, { color: theme.muted }]}>Theme</Text>

              <Pressable style={[styles.menuOption, { borderColor: theme.border }]} onPress={() => setIsDark(!isDark)}>
                <Text style={[styles.menuOptionText, { color: theme.text }]}>{isDark ? 'Dark Mode' : 'Light Mode'}</Text>
                <Text style={[styles.menuOptionPill, { backgroundColor: accent }]}>Toggle</Text>
              </Pressable>
            </View>

            <View style={styles.menuSection}>
              <Text style={[styles.menuLabel, { color: theme.muted }]}>Distance Units</Text>

              <View style={styles.unitRow}>
                <Pressable
                  style={[styles.unitButton, { borderColor: theme.border }, unit === 'cm' && styles.activeUnitButton]}
                  onPress={() => setUnit('cm')}
                >
                  <Text style={[styles.unitButtonText, { color: unit === 'cm' ? '#111827' : theme.text }]}>cm</Text>
                </Pressable>

                <Pressable
                  style={[styles.unitButton, { borderColor: theme.border }, unit === 'in' && styles.activeUnitButton]}
                  onPress={() => setUnit('in')}
                >
                  <Text style={[styles.unitButtonText, { color: unit === 'in' ? '#111827' : theme.text }]}>in</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.menuSection}>
              <Text style={[styles.menuLabel, { color: theme.muted }]}>Bluetooth</Text>

              <View style={[styles.bluetoothStatus, { borderColor: theme.border }]}>
                <View
                  style={[
                    styles.bluetoothStatusDot,
                    { backgroundColor: connectedDevice ? '#22c55e' : isScanning ? accent : theme.muted },
                  ]}
                />
                <View style={styles.bluetoothStatusText}>
                  <Text style={[styles.bluetoothStatusTitle, { color: theme.text }]}>
                    {connectedDevice
                      ? `Connected to ${connectedDevice.name}`
                      : connectionState === 'connecting'
                        ? 'Connecting…'
                        : isScanning
                          ? 'Scanning nearby devices…'
                          : 'Not connected'}
                  </Text>
                  <Text style={[styles.bluetoothStatusMeta, { color: theme.muted }]}>Adapter: {adapterState}</Text>
                </View>
              </View>

              {connectedDevice ? (
                <Pressable
                  style={[styles.bluetoothButton, styles.disconnectButton]}
                  onPress={() => void disconnect()}
                >
                  <Text style={styles.disconnectButtonText}>Disconnect</Text>
                </Pressable>
              ) : (
                <Pressable
                  style={[styles.bluetoothButton, { backgroundColor: accent }, isScanning && styles.disabledButton]}
                  disabled={isScanning || connectionState === 'connecting'}
                  onPress={() => void scan()}
                >
                  <Text style={styles.bluetoothButtonText}>
                    {isScanning ? 'Scanning…' : devices.length > 0 ? 'Scan Again' : 'Find Bluetooth Devices'}
                  </Text>
                </Pressable>
              )}

              {bluetoothError && (
                <View style={styles.bluetoothError}>
                  <Text style={styles.bluetoothErrorText}>{bluetoothError}</Text>
                </View>
              )}

              {!connectedDevice && devices.length > 0 && (
                <>
                  <Text style={[styles.deviceListLabel, { color: theme.muted }]}>Nearby BLE devices</Text>
                  <View>
                    {devices.map((device) => (
                      <Pressable
                        key={device.id}
                        style={[styles.deviceRow, { borderColor: theme.border }]}
                        disabled={connectionState === 'connecting'}
                        onPress={() => void connect(device.id)}
                      >
                        <View style={styles.deviceInfo}>
                          <Text style={[styles.deviceName, { color: theme.text }]} numberOfLines={1}>
                            {device.name}
                          </Text>
                          <Text style={[styles.deviceId, { color: theme.muted }]} numberOfLines={1}>
                            {device.id}
                          </Text>
                        </View>
                        <Text
                          style={[
                            styles.deviceSignal,
                            { color: device.name === 'PrecisionShot' ? accent : theme.muted },
                          ]}
                        >
                          {device.rssi === null ? 'Connect' : `${device.rssi} dBm`}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}
            </View>
          </ScrollView>
        </View>
      )}

      <Pressable style={styles.floatingMenuButton} onPress={() => setIsMenuOpen(!isMenuOpen)}>
        <Text style={styles.floatingMenuIcon}>{isMenuOpen ? '×' : '☰'}</Text>
      </Pressable>
    </View>
  );
}

function BluetoothDiagnosticsPanel({
  adapterState,
  characteristicUuid,
  clearLogs,
  device,
  diagnostics,
  now,
  serviceUuid,
  theme,
}: {
  adapterState: string;
  characteristicUuid: string;
  clearLogs: () => void;
  device: { id: string; name: string; rssi: number | null };
  diagnostics: BleDiagnostics;
  now: number;
  serviceUuid: string;
  theme: typeof darkTheme;
}) {
  const signal = getSignalQuality(diagnostics.rssi);
  const uptime = diagnostics.connectedAt ? formatElapsed(now - diagnostics.connectedAt) : 'Starting…';
  const lastPacketAge = diagnostics.lastPacketAt
    ? `${formatElapsed(now - diagnostics.lastPacketAt)} ago`
    : 'Waiting for data';
  const validPacketRate = diagnostics.notificationsReceived
    ? `${(((diagnostics.notificationsReceived - diagnostics.malformedPackets) / diagnostics.notificationsReceived) * 100).toFixed(1)}%`
    : '100%';

  return (
    <View style={[styles.bluetoothDiagnostics, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <View style={styles.diagnosticsHeader}>
        <View style={styles.diagnosticsHeading}>
          <View style={[styles.liveDot, { backgroundColor: signal.color }]} />
          <View>
            <Text style={[styles.cardTitle, { color: theme.text }]}>Bluetooth Diagnostics</Text>
            <Text style={[styles.diagnosticsSubtitle, { color: theme.muted }]}>Live session · {uptime}</Text>
          </View>
        </View>
        <View style={[styles.signalPill, { borderColor: signal.color }]}>
          <Text style={[styles.signalPillText, { color: signal.color }]}>{signal.label}</Text>
        </View>
      </View>

      <View style={styles.diagnosticsMetricGrid}>
        <DiagnosticMetric
          label="Signal"
          value={diagnostics.rssi === null ? '— dBm' : `${diagnostics.rssi} dBm`}
          detail="Updated every 5 sec"
          theme={theme}
        />
        <DiagnosticMetric
          label="Notifications"
          value={String(diagnostics.notificationsReceived)}
          detail={`${diagnostics.packetsLastMinute} in last minute`}
          theme={theme}
        />
        <DiagnosticMetric
          label="Data Received"
          value={formatBytes(diagnostics.bytesReceived)}
          detail={lastPacketAge}
          theme={theme}
        />
        <DiagnosticMetric
          label="Packet Health"
          value={validPacketRate}
          detail={`${diagnostics.malformedPackets} unrecognized`}
          theme={theme}
        />
        <DiagnosticMetric
          label="Shot Packets"
          value={String(diagnostics.shotPackets)}
          detail={`${diagnostics.diagnosticMessages} device messages`}
          theme={theme}
        />
        <DiagnosticMetric
          label="BLE Link"
          value={`MTU ${diagnostics.mtu ?? '—'}`}
          detail={`${diagnostics.servicesDiscovered} services discovered`}
          theme={theme}
        />
      </View>

      <View style={[styles.connectionDetails, { backgroundColor: theme.debugBackground, borderColor: theme.border }]}>
        <Text style={[styles.diagnosticsSectionTitle, { color: accent }]}>Connection</Text>
        <DiagnosticLine label="Device" value={device.name} theme={theme} />
        <DiagnosticLine label="Device ID" value={device.id} theme={theme} monospace />
        <DiagnosticLine label="Adapter" value={adapterState} theme={theme} />
        <DiagnosticLine label="Service" value={serviceUuid} theme={theme} monospace />
        <DiagnosticLine label="Notify characteristic" value={characteristicUuid} theme={theme} monospace />
        <DiagnosticLine
          label="Discovery"
          value={`${diagnostics.servicesDiscovered} services / ${diagnostics.characteristicCount} service characteristics`}
          theme={theme}
        />
      </View>

      <View style={[styles.rawPacketPanel, { backgroundColor: theme.debugBackground, borderColor: theme.border }]}>
        <View style={styles.diagnosticsSectionHeader}>
          <Text style={[styles.diagnosticsSectionTitle, { color: accent }]}>Latest Incoming Data</Text>
          <Text style={[styles.packetAge, { color: theme.muted }]}>{lastPacketAge}</Text>
        </View>
        <Text style={[styles.rawDataLabel, { color: theme.muted }]}>Decoded payload</Text>
        <Text selectable style={[styles.rawDataValue, { color: theme.text }]}>
          {diagnostics.lastRawValue ?? 'Waiting for the first Bluetooth notification…'}
        </Text>
        <Text style={[styles.rawDataLabel, { color: theme.muted }]}>Base64 from BLE</Text>
        <Text selectable style={[styles.base64Value, { color: theme.muted }]}>
          {diagnostics.lastBase64Value ?? '—'}
        </Text>
      </View>

      <View style={styles.diagnosticsLogSection}>
        <View style={styles.diagnosticsSectionHeader}>
          <Text style={[styles.diagnosticsSectionTitle, { color: accent }]}>Event Log</Text>
          <Pressable
            accessibilityRole="button"
            disabled={diagnostics.logs.length === 0}
            onPress={clearLogs}
            style={[styles.clearLogButton, { borderColor: theme.border }, diagnostics.logs.length === 0 && styles.disabledButton]}
          >
            <Text style={[styles.clearLogButtonText, { color: theme.text }]}>Clear</Text>
          </Pressable>
        </View>

        {diagnostics.logs.length === 0 ? (
          <Text style={[styles.emptyText, { color: theme.muted }]}>No Bluetooth events logged yet.</Text>
        ) : (
          diagnostics.logs.slice(0, 20).map((entry) => {
            const logColor =
              entry.level === 'error'
                ? '#ef4444'
                : entry.level === 'warning'
                  ? '#f59e0b'
                  : entry.level === 'data'
                    ? '#22c55e'
                    : '#38bdf8';

            return (
              <View key={entry.id} style={[styles.logRow, { borderColor: theme.border }]}>
                <View style={[styles.logLevelDot, { backgroundColor: logColor }]} />
                <View style={styles.logContent}>
                  <View style={styles.logTitleRow}>
                    <Text style={[styles.logMessage, { color: theme.text }]}>{entry.message}</Text>
                    <Text style={[styles.logTime, { color: theme.muted }]}>
                      {new Date(entry.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </Text>
                  </View>
                  {entry.detail && (
                    <Text selectable style={[styles.logDetail, { color: theme.muted }]}>
                      {entry.detail}
                    </Text>
                  )}
                </View>
              </View>
            );
          })
        )}
        {diagnostics.logs.length > 20 && (
          <Text style={[styles.moreLogsText, { color: theme.muted }]}>
            Showing newest 20 of {diagnostics.logs.length} retained events
          </Text>
        )}
      </View>
    </View>
  );
}

function DiagnosticMetric({
  detail,
  label,
  theme,
  value,
}: {
  detail: string;
  label: string;
  theme: typeof darkTheme;
  value: string;
}) {
  return (
    <View style={[styles.diagnosticMetric, { backgroundColor: theme.debugBackground, borderColor: theme.border }]}>
      <Text style={[styles.metricLabel, { color: theme.muted }]}>{label}</Text>
      <Text style={[styles.metricValue, { color: theme.text }]}>{value}</Text>
      <Text style={[styles.metricDetail, { color: theme.muted }]}>{detail}</Text>
    </View>
  );
}

function DiagnosticLine({
  label,
  monospace = false,
  theme,
  value,
}: {
  label: string;
  monospace?: boolean;
  theme: typeof darkTheme;
  value: string;
}) {
  return (
    <View style={styles.diagnosticLine}>
      <Text style={[styles.diagnosticLineLabel, { color: theme.muted }]}>{label}</Text>
      <Text
        selectable
        style={[styles.diagnosticLineValue, { color: theme.text }, monospace && styles.monospaceText]}
      >
        {value}
      </Text>
    </View>
  );
}

function StatCard({ label, value, theme }: { label: string; value: string; theme: typeof darkTheme }) {
  return (
    <View style={[styles.statCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <Text style={[styles.statValue, { color: theme.text }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: theme.muted }]}>{label}</Text>
    </View>
  );
}

function DetailBlock({ label, value, theme }: { label: string; value: string; theme: typeof darkTheme }) {
  return (
    <View style={styles.detailBlock}>
      <Text style={[styles.detailLabel, { color: theme.muted }]}>{label}</Text>
      <Text style={[styles.detailValue, { color: theme.text }]}>{value}</Text>
    </View>
  );
}

const darkTheme = {
  background: '#0f172a',
  card: '#111827',
  debugBackground: '#0b1120',
  text: '#f8fafc',
  muted: '#94a3b8',
  border: '#334155',
};

const lightTheme = {
  background: '#f8fafc',
  card: '#ffffff',
  debugBackground: '#f1f5f9',
  text: '#0f172a',
  muted: '#64748b',
  border: '#cbd5e1',
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingTop: 72,
    paddingHorizontal: 20,
    paddingBottom: 110,
    gap: 18,
  },
  header: {
    gap: 8,
  },
  eyebrow: {
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 34,
    fontWeight: '900',
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 23,
  },
  targetCard: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 24,
    padding: 20,
    gap: 18,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitle: {
    alignSelf: 'flex-start',
    fontSize: 20,
    fontWeight: '900',
  },
  pageText: {
    fontSize: 12,
    fontWeight: '800',
  },
  target: {
    width: targetSize,
    height: targetSize,
    borderWidth: 2,
    borderRadius: targetRadius,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1f2937',
    overflow: 'hidden',
  },
  ring: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: 'rgba(236, 211, 22, 0.45)',
    borderRadius: 999,
  },
  ringOuter: {
    width: 190,
    height: 190,
  },
  ringMiddle: {
    width: 126,
    height: 126,
  },
  ringInner: {
    width: 64,
    height: 64,
  },
  bullseye: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  shotDot: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  targetNote: {
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  buttonRow: {
    width: '100%',
    flexDirection: 'row',
    gap: 12,
  },
  primaryButton: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 16,
    backgroundColor: accent,
    paddingVertical: 14,
  },
  primaryButtonText: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '900',
  },
  secondaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 20,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '900',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  statCard: {
    width: '47.8%',
    borderWidth: 1,
    borderRadius: 20,
    padding: 18,
  },
  statValue: {
    fontSize: 28,
    fontWeight: '900',
  },
  statLabel: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: '700',
  },
  dashboardCard: {
    borderWidth: 1,
    borderRadius: 24,
    padding: 20,
    gap: 16,
  },
  latestShotHero: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
  },
  latestShotRight: {
    alignItems: 'flex-end',
  },
  latestShotGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  detailBlock: {
    minWidth: '30%',
    flex: 1,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  detailValue: {
    marginTop: 6,
    fontSize: 18,
    fontWeight: '900',
  },
  bigDetailValue: {
    marginTop: 6,
    fontSize: 28,
    fontWeight: '900',
  },
  debugPanel: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    gap: 12,
  },
  debugTitle: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  debugGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  emptyText: {
    fontSize: 15,
    lineHeight: 22,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    paddingVertical: 14,
    gap: 14,
  },
  historyIndex: {
    width: 40,
    fontSize: 16,
    fontWeight: '900',
  },
  historyInfo: {
    flex: 1,
  },
  historyTitle: {
    fontSize: 15,
    fontWeight: '900',
  },
  historyMeta: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
  },
  paginationRow: {
    flexDirection: 'row',
    gap: 12,
  },
  pageButton: {
    flex: 1,
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
  },
  pageButtonText: {
    fontSize: 14,
    fontWeight: '900',
  },
  disabledButton: {
    opacity: 0.35,
  },
  floatingMenuButton: {
    position: 'absolute',
    right: 20,
    bottom: 28,
    width: 58,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 29,
    backgroundColor: accent,
    shadowColor: '#000000',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  floatingMenuIcon: {
    color: '#111827',
    fontSize: 28,
    fontWeight: '900',
  },
  menuPanel: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 98,
    maxHeight: '78%',
    borderWidth: 1,
    borderRadius: 24,
    padding: 18,
    gap: 18,
    shadowColor: '#000000',
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  menuTitle: {
    fontSize: 20,
    fontWeight: '900',
  },
  menuScroll: {
    flexShrink: 1,
  },
  menuScrollContent: {
    gap: 18,
    paddingBottom: 2,
  },
  menuSection: {
    gap: 10,
  },
  menuLabel: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  menuOption: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  menuOptionText: {
    fontSize: 14,
    fontWeight: '900',
  },
  menuOptionPill: {
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    color: '#111827',
    fontSize: 11,
    fontWeight: '900',
  },
  unitRow: {
    flexDirection: 'row',
    gap: 10,
  },
  unitButton: {
    flex: 1,
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 11,
  },
  activeUnitButton: {
    backgroundColor: accent,
    borderColor: accent,
  },
  unitButtonText: {
    fontSize: 14,
    fontWeight: '900',
  },
  bluetoothStatus: {
    minHeight: 58,
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  bluetoothStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  bluetoothStatusText: {
    flex: 1,
  },
  bluetoothStatusTitle: {
    fontSize: 14,
    fontWeight: '900',
  },
  bluetoothStatusMeta: {
    marginTop: 3,
    fontSize: 11,
    fontWeight: '700',
  },
  bluetoothButton: {
    alignItems: 'center',
    borderRadius: 14,
    paddingVertical: 12,
  },
  bluetoothButtonText: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '900',
  },
  disconnectButton: {
    borderWidth: 1,
    borderColor: '#ef4444',
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
  },
  disconnectButtonText: {
    color: '#ef4444',
    fontSize: 14,
    fontWeight: '900',
  },
  bluetoothError: {
    borderRadius: 12,
    padding: 10,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
  },
  bluetoothErrorText: {
    color: '#ef4444',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  deviceListLabel: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  deviceRow: {
    minHeight: 56,
    borderTopWidth: 1,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    fontSize: 14,
    fontWeight: '900',
  },
  deviceId: {
    marginTop: 3,
    fontSize: 10,
  },
  deviceSignal: {
    fontSize: 11,
    fontWeight: '900',
  },
  bluetoothDiagnostics: {
    borderWidth: 1,
    borderRadius: 24,
    padding: 18,
    gap: 16,
  },
  diagnosticsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  diagnosticsHeading: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  liveDot: {
    width: 11,
    height: 11,
    borderRadius: 6,
  },
  diagnosticsSubtitle: {
    marginTop: 3,
    fontSize: 12,
    fontWeight: '700',
  },
  signalPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  signalPillText: {
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  diagnosticsMetricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  diagnosticMetric: {
    width: '48.2%',
    minHeight: 104,
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
  },
  metricLabel: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  metricValue: {
    marginTop: 8,
    fontSize: 21,
    fontWeight: '900',
  },
  metricDetail: {
    marginTop: 5,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },
  connectionDetails: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    gap: 10,
  },
  diagnosticsSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  diagnosticsSectionTitle: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  diagnosticLine: {
    gap: 3,
  },
  diagnosticLineLabel: {
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  diagnosticLineValue: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  monospaceText: {
    fontFamily: 'monospace',
  },
  rawPacketPanel: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    gap: 8,
  },
  packetAge: {
    fontSize: 10,
    fontWeight: '800',
  },
  rawDataLabel: {
    marginTop: 3,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  rawDataValue: {
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
  },
  base64Value: {
    fontFamily: 'monospace',
    fontSize: 10,
    lineHeight: 15,
  },
  diagnosticsLogSection: {
    gap: 8,
  },
  clearLogButton: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  clearLogButtonText: {
    fontSize: 11,
    fontWeight: '900',
  },
  logRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingTop: 10,
    gap: 9,
  },
  logLevelDot: {
    width: 8,
    height: 8,
    marginTop: 5,
    borderRadius: 4,
  },
  logContent: {
    flex: 1,
  },
  logTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  logMessage: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  logTime: {
    fontSize: 9,
    lineHeight: 16,
    fontWeight: '700',
  },
  logDetail: {
    marginTop: 3,
    fontFamily: 'monospace',
    fontSize: 10,
    lineHeight: 15,
  },
  moreLogsText: {
    textAlign: 'center',
    fontSize: 10,
    fontWeight: '700',
  },
});
