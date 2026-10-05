import { useEffect, useState } from 'react';
import {
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    View,
    useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Action, palettes, SettingRow } from '@/components/controls';
import { Target } from '@/components/Target';
import { usePrecisionShotBle } from '@/hooks/usePrecisionShotBle';
import { formatDistance } from '@/lib/protocol';

type Panel = 'SETTINGS' | 'DEBUGZONE' | 'DEBUG' | null;
const effects = [
    { name: 'Confetti Chaos', tune: 'The Entertainer', command: 'CONFETTI' },
    { name: 'Cosmic Orbit', tune: 'Greensleeves', command: 'ORBIT' },
    { name: 'Jelly Bounce', tune: 'Für Elise', command: 'BOUNCE' },
    { name: 'Warp Speed', tune: 'Mountain King', command: 'WARP' },
];

export default function TrainingScreen() {
    const [panel, setPanel] = useState<Panel>(null);
    const ble = usePrecisionShotBle(panel === 'DEBUGZONE');
    const board = ble.board;
    const [showDebug, setShowDebug] = useState(false);
    const { width } = useWindowDimensions();
    const colors = palettes[board?.theme ?? 'DARK'];
    const ready = ble.connectionState === 'connected' && ble.isSynced;
    const disabled = !ready || ble.busy;
    const complete = board?.mode === 'CLASSIC' && board.remaining === 0;
    const fullscreen = board?.fullscreen ?? false;
    const targetSize = Math.min(width - 72, fullscreen ? 340 : 276);
    const packet = board?.packet ?? 'No board packet available';
    const boardPage = board?.page;
    const packetBytes = Array.from(packet, (character) => character.charCodeAt(0));
    const packetView =
        board?.view === 'HEX'
            ? packetBytes.map((byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ')
            : board?.view === 'BINARY'
              ? packetBytes.map((byte) => byte.toString(2).padStart(8, '0')).join(' ')
              : packet;

    // Opening a screen on the board also opens its matching app panel.
    useEffect(() => {
        if (boardPage) setPanel(boardPage === 'TRAINING' ? null : boardPage);
    }, [boardPage, ble.connectedDevice?.id]);

    function run(command: string) {
        ble.clearError();
        void ble.sendCommand(command).catch(() => undefined);
    }

    function open(next: Panel) {
        setPanel(next);
        if (ready) {
            ble.clearError();
            // The confirmed destination wins over any older state already in flight.
            void ble
                .sendCommand(`NAV:${next ?? 'TRAINING'}`)
                .then(() => setPanel(next))
                .catch(() => setPanel(boardPage === 'TRAINING' ? null : (boardPage ?? null)));
        }
    }

    const connectionLabel =
        ble.connectionState === 'connecting'
            ? 'Connecting…'
            : ready
              ? 'Board connected'
              : ble.connectionState === 'connected'
                ? 'Synchronizing…'
                : 'Connect your board';

    return (
        <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
            <StatusBar style={board?.theme === 'LIGHT' ? 'dark' : 'light'} />
            <ScrollView contentContainerStyle={styles.content}>
                <View style={styles.header}>
                    <Text style={[styles.brand, { color: colors.text }]}>
                        PrecisionShot<Text style={{ color: colors.accent }}>.</Text>
                    </Text>
                    <Action label="Settings" onPress={() => open('SETTINGS')} colors={colors} />
                </View>
                {/* Keep modes and the target on the main screen. */}
                <View
                    style={[
                        styles.tabs,
                        { backgroundColor: colors.surface, borderColor: colors.line },
                    ]}
                >
                    {(['FREESTYLE', 'CLASSIC', 'RAPID'] as const).map((mode) => (
                        <Pressable
                            key={mode}
                            accessibilityRole="tab"
                            accessibilityLabel={mode[0] + mode.slice(1).toLowerCase()}
                            accessibilityState={{
                                selected: board?.mode === mode,
                                disabled: disabled || mode === 'RAPID',
                            }}
                            disabled={disabled || mode === 'RAPID'}
                            onPress={() => run(`MODE:${mode}`)}
                            style={[
                                styles.tab,
                                board?.mode === mode && { backgroundColor: colors.accent },
                                mode === 'RAPID' && { opacity: 0.35 },
                            ]}
                        >
                            <Text
                                style={[
                                    styles.tabText,
                                    { color: board?.mode === mode ? colors.onAccent : colors.text },
                                ]}
                            >
                                {mode[0] + mode.slice(1).toLowerCase()}
                            </Text>
                        </Pressable>
                    ))}
                </View>
                <View style={styles.targetHeading}>
                    <Text style={[styles.caption, { color: colors.muted }]}>
                        {board ? formatDistance(board) : 'TARGET'}
                    </Text>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                        disabled={disabled}
                        onPress={() => run(`FULL:${fullscreen ? 0 : 1}`)}
                        style={styles.fullscreenButton}
                    >
                        <Text
                            style={[
                                styles.small,
                                { color: colors.accent, opacity: disabled ? 0.4 : 1 },
                            ]}
                        >
                            {fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                        </Text>
                    </Pressable>
                </View>
                <Target size={targetSize} />
                <View
                    style={[
                        styles.latest,
                        { backgroundColor: colors.surface, borderColor: colors.line },
                    ]}
                >
                    <View style={styles.latestTop}>
                        <Text style={[styles.caption, { color: colors.muted }]}>
                            {complete ? 'SESSION TOTAL' : 'LATEST SHOT'}
                        </Text>
                        <Text style={[styles.small, { color: colors.muted }]}>
                            {board?.lastScore !== null && ble.lastShot
                                ? new Date(ble.lastShot.time).toLocaleTimeString([], {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                  })
                                : '—'}
                        </Text>
                    </View>
                    <Text style={[styles.score, { color: colors.accent }]}>
                        {complete ? board.total : (board?.lastScore ?? '—')}
                        <Text style={[styles.scoreSuffix, { color: colors.muted }]}>
                            {' '}
                            / {complete ? 100 : 10}
                        </Text>
                    </Text>
                    <View style={styles.latestTop}>
                        <Text style={[styles.small, { color: colors.text }]}>
                            {board
                                ? board.mode === 'CLASSIC'
                                    ? `${board.remaining} shots left`
                                    : `${board.shots} shots`
                                : 'Waiting for board'}
                        </Text>
                        <Text style={[styles.small, { color: colors.muted }]}>
                            {complete
                                ? 'Next shot starts a new session'
                                : `Total ${board?.total ?? '—'}`}
                        </Text>
                    </View>
                </View>
                <View style={styles.actions}>
                    <Action
                        label="Simulate shot"
                        primary
                        onPress={() => run('TEST')}
                        disabled={disabled}
                        colors={colors}
                        style={styles.grow}
                    />
                    <Action
                        label="Reset"
                        onPress={() => run('RESET')}
                        disabled={disabled}
                        colors={colors}
                        style={styles.reset}
                    />
                </View>
                <Pressable
                    accessibilityRole="button"
                    onPress={() => open('SETTINGS')}
                    style={styles.connection}
                >
                    <View
                        style={[styles.dot, { backgroundColor: ready ? '#6EA58A' : colors.muted }]}
                    />
                    <Text style={[styles.small, { color: colors.muted }]}>
                        {ble.busy ? 'Updating board…' : connectionLabel}
                    </Text>
                </Pressable>
                {ble.error && (
                    <Text accessibilityRole="alert" style={styles.error}>
                        {ble.error}
                    </Text>
                )}
                {/* This section is only shown when its settings switch is on. */}
                {showDebug && (
                    <View style={[styles.debugCard, { borderColor: colors.line }]}>
                        <Text style={[styles.sectionTitle, { color: colors.text }]}>
                            Debug information
                        </Text>
                        <Text selectable style={[styles.small, { color: colors.muted }]}>
                            {ble.connectedDevice?.id ?? 'Disconnected'} · {ble.adapterState}
                        </Text>
                        <Text style={[styles.small, { color: colors.muted }]}>
                            {ble.notifications} notifications · State {board?.revision ?? '—'} ·{' '}
                            {board?.page ?? '—'}
                        </Text>
                        <Text style={[styles.small, { color: colors.muted }]}>
                            Sensor positions are not available yet.
                        </Text>
                        {ble.logs.slice(0, 6).map((entry) => (
                            <Text
                                selectable
                                key={entry.id}
                                style={[styles.log, { color: colors.muted }]}
                            >
                                {entry.text}
                            </Text>
                        ))}
                    </View>
                )}
            </ScrollView>

            {/* Settings and all the extra tests live in this panel. */}
            <Modal
                visible={panel !== null}
                animationType="slide"
                transparent
                onRequestClose={() => open(null)}
            >
                <View style={styles.scrim}>
                    <SafeAreaView style={[styles.sheet, { backgroundColor: colors.background }]}>
                        <View style={styles.sheetHeader}>
                            <Text style={[styles.sectionTitle, { color: colors.text }]}>
                                {panel === 'DEBUG'
                                    ? 'Session Debug'
                                    : panel === 'DEBUGZONE'
                                      ? 'Debug Zone'
                                      : 'Settings'}
                            </Text>
                            <Action label="Done" onPress={() => open(null)} colors={colors} />
                        </View>
                        <ScrollView contentContainerStyle={styles.sheetContent}>
                            {panel === 'SETTINGS' && (
                                <>
                                    <Text style={[styles.caption, { color: colors.muted }]}>
                                        BLUETOOTH
                                    </Text>
                                    <Text style={[styles.sectionTitle, { color: colors.text }]}>
                                        {connectionLabel}
                                    </Text>
                                    <View style={styles.actions}>
                                        {ble.connectedDevice ? (
                                            <>
                                                <Action
                                                    label="Disconnect"
                                                    onPress={() => void ble.disconnect()}
                                                    colors={colors}
                                                    style={styles.grow}
                                                />
                                                <Action
                                                    label="Sync board"
                                                    onPress={() => run('STATE')}
                                                    disabled={ble.busy}
                                                    colors={colors}
                                                    style={styles.grow}
                                                />
                                            </>
                                        ) : (
                                            <Action
                                                label={ble.isScanning ? 'Stop scan' : 'Find board'}
                                                primary
                                                onPress={() =>
                                                    void (ble.isScanning
                                                        ? ble.stopScan()
                                                        : ble.scan())
                                                }
                                                disabled={ble.connectionState === 'connecting'}
                                                colors={colors}
                                                style={styles.grow}
                                            />
                                        )}
                                    </View>
                                    {!ble.connectedDevice &&
                                        ble.devices.map((device) => (
                                            <Action
                                                key={device.id}
                                                label={`Connect ${device.name}`}
                                                onPress={() => void ble.connect(device.id)}
                                                disabled={ble.connectionState === 'connecting'}
                                                colors={colors}
                                            />
                                        ))}
                                    <SettingRow
                                        label="Distance"
                                        value={board ? formatDistance(board) : '—'}
                                        minus={() => run('DIST:-')}
                                        plus={() => run('DIST:+')}
                                        disabled={disabled}
                                        colors={colors}
                                    />
                                    <View style={styles.actions}>
                                        <Action
                                            label="Meters"
                                            primary={board?.unit === 'M'}
                                            onPress={() => run('UNIT:M')}
                                            disabled={disabled}
                                            colors={colors}
                                            style={styles.grow}
                                        />
                                        <Action
                                            label="Feet"
                                            primary={board?.unit === 'FT'}
                                            onPress={() => run('UNIT:FT')}
                                            disabled={disabled}
                                            colors={colors}
                                            style={styles.grow}
                                        />
                                    </View>
                                    <SettingRow
                                        label="Sensitivity"
                                        value={board?.sensitivity.toString() ?? '—'}
                                        minus={() => run('CAL:-')}
                                        plus={() => run('CAL:+')}
                                        disabled={disabled}
                                        colors={colors}
                                    />
                                    <Text style={[styles.small, { color: colors.muted }]}>
                                        Higher values are less sensitive.
                                    </Text>
                                    <View style={styles.actions}>
                                        <Action
                                            label="Dark"
                                            primary={board?.theme === 'DARK'}
                                            onPress={() => run('THEME:DARK')}
                                            disabled={disabled}
                                            colors={colors}
                                            style={styles.grow}
                                        />
                                        <Action
                                            label="Light"
                                            primary={board?.theme === 'LIGHT'}
                                            onPress={() => run('THEME:LIGHT')}
                                            disabled={disabled}
                                            colors={colors}
                                            style={styles.grow}
                                        />
                                    </View>
                                    <View style={styles.toggleRow}>
                                        <Text
                                            style={[styles.small, { color: colors.text, flex: 1 }]}
                                        >
                                            Enable debug information
                                        </Text>
                                        <Switch
                                            accessibilityLabel="Enable debug information"
                                            value={showDebug}
                                            onValueChange={setShowDebug}
                                            trackColor={{ true: colors.accent }}
                                        />
                                    </View>
                                    <Action
                                        label="Debug Zone"
                                        onPress={() => open('DEBUGZONE')}
                                        colors={colors}
                                    />
                                </>
                            )}
                            {panel === 'DEBUGZONE' && (
                                <>
                                    <View
                                        style={[
                                            styles.readings,
                                            {
                                                backgroundColor: colors.surface,
                                                borderColor: colors.line,
                                            },
                                        ]}
                                    >
                                        <Text style={[styles.small, { color: colors.muted }]}>
                                            LIVE READINGS
                                        </Text>
                                        <View style={styles.actions}>
                                            {[
                                                ['3.3 V regulator', board?.regulator33Temperature],
                                                ['5 V regulator', board?.regulator5Temperature],
                                            ].map(([label, temperature]) => (
                                                <View key={String(label)} style={styles.grow}>
                                                    <Text
                                                        style={[
                                                            styles.small,
                                                            { color: colors.muted },
                                                        ]}
                                                    >
                                                        {label}
                                                    </Text>
                                                    <Text
                                                        style={[
                                                            styles.readingValue,
                                                            { color: colors.text },
                                                        ]}
                                                    >
                                                        {typeof temperature === 'number'
                                                            ? `${temperature.toFixed(1)} \u00b0C`
                                                            : '--'}
                                                    </Text>
                                                </View>
                                            ))}
                                        </View>
                                        <Text style={[styles.small, { color: colors.muted }]}>
                                            Sensor input
                                        </Text>
                                        <Text
                                            style={[styles.readingValue, { color: colors.accent }]}
                                        >
                                            {board?.sensorMillivolts == null
                                                ? '--'
                                                : `${(board.sensorMillivolts / 1000).toFixed(3)} V`}
                                        </Text>
                                        <Text style={[styles.small, { color: colors.text }]}>
                                            ADC {board?.sensorRaw ?? '--'} / Threshold{' '}
                                            {board?.sensitivity ?? '--'}
                                            {' | '}
                                            {board?.sensorRaw == null
                                                ? 'Unavailable'
                                                : board.sensorDetected
                                                  ? 'Detected'
                                                  : 'Below threshold'}
                                        </Text>
                                        <Text style={[styles.small, { color: colors.muted }]}>
                                            Live updates | J_PSB pin 9 | 0-3.3 V, shared ground
                                        </Text>
                                    </View>
                                    <Action
                                        label="Back to Settings"
                                        onPress={() => open('SETTINGS')}
                                        colors={colors}
                                    />
                                    <Text style={[styles.small, { color: colors.muted }]}>
                                        Play animations and their public domain tunes on the board.
                                    </Text>
                                    {effects.map((effect) => (
                                        <Action
                                            key={effect.command}
                                            label={`${effect.name} · ${effect.tune}`}
                                            onPress={() => run(`FX:${effect.command}`)}
                                            disabled={disabled}
                                            colors={colors}
                                        />
                                    ))}
                                    <Action
                                        label="Stop sound and animation"
                                        onPress={() => run('FX:STOP')}
                                        disabled={disabled}
                                        colors={colors}
                                    />
                                    <Action
                                        label="Session Debug"
                                        onPress={() => open('DEBUG')}
                                        colors={colors}
                                    />
                                    <Action
                                        label={board?.menu ? 'Close board menu' : 'Open board menu'}
                                        onPress={() =>
                                            run(board?.menu ? 'MENU:CLOSE' : 'MENU:OPEN')
                                        }
                                        disabled={disabled}
                                        colors={colors}
                                    />
                                    <Action
                                        label="Clear app debug log"
                                        onPress={ble.clearLogs}
                                        colors={colors}
                                    />
                                </>
                            )}
                            {panel === 'DEBUG' && (
                                <>
                                    <Action
                                        label="Back to Debug Zone"
                                        onPress={() => open('DEBUGZONE')}
                                        colors={colors}
                                    />
                                    <View style={styles.actions}>
                                        {(['PAYLOAD', 'HEX', 'BINARY'] as const).map((view) => (
                                            <Action
                                                key={view}
                                                label={view}
                                                primary={board?.view === view}
                                                onPress={() => run(`VIEW:${view}`)}
                                                disabled={disabled}
                                                colors={colors}
                                                style={styles.grow}
                                            />
                                        ))}
                                    </View>
                                    <Text
                                        selectable
                                        style={[
                                            styles.packet,
                                            { color: colors.text, backgroundColor: colors.surface },
                                        ]}
                                    >
                                        {packetView}
                                    </Text>
                                    <Text style={[styles.small, { color: colors.muted }]}>
                                        {board?.delivery === 'EXAMPLE'
                                            ? 'Example only · no shot has been sent'
                                            : `Packet status: ${board?.delivery.toLowerCase() ?? 'disconnected'}`}
                                    </Text>
                                    <Text style={[styles.small, { color: colors.muted }]}>
                                        Board mode {board?.mode ?? '—'} · {board?.shots ?? 0} shots
                                        · Total {board?.total ?? 0}
                                    </Text>
                                    <Action
                                        label="Simulate shot"
                                        onPress={() => run('TEST')}
                                        disabled={disabled}
                                        colors={colors}
                                    />
                                    {ble.logs.slice(0, 12).map((entry) => (
                                        <Text
                                            selectable
                                            key={entry.id}
                                            style={[styles.log, { color: colors.muted }]}
                                        >
                                            {entry.text}
                                        </Text>
                                    ))}
                                </>
                            )}
                            {ble.error && (
                                <Text accessibilityRole="alert" style={styles.error}>
                                    {ble.error}
                                </Text>
                            )}
                        </ScrollView>
                    </SafeAreaView>
                </View>
            </Modal>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1 },
    content: {
        width: '100%',
        maxWidth: 520,
        alignSelf: 'center',
        padding: 24,
        gap: 20,
        paddingBottom: 36,
    },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    brand: { fontSize: 23, fontWeight: '700', letterSpacing: -0.8 },
    tabs: { flexDirection: 'row', borderWidth: 1, borderRadius: 16, padding: 5 },
    tab: { flex: 1, paddingVertical: 13, alignItems: 'center', borderRadius: 11 },
    tabText: { fontSize: 14, fontWeight: '600' },
    targetHeading: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: -10,
    },
    fullscreenButton: { minHeight: 44, justifyContent: 'center', paddingLeft: 12 },
    caption: { fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
    small: { fontSize: 13, lineHeight: 20 },
    readings: { padding: 16, gap: 10, borderRadius: 16, borderWidth: 1 },
    readingValue: { fontSize: 26, fontWeight: '700' },
    latest: { borderWidth: 1, borderRadius: 20, padding: 20, gap: 8 },
    latestTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
    score: { fontSize: 56, fontWeight: '600', letterSpacing: -2 },
    scoreSuffix: { fontSize: 19, letterSpacing: 0 },
    actions: { flexDirection: 'row', gap: 10 },
    grow: { flex: 1 },
    reset: { width: 100 },
    connection: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 8,
        minHeight: 32,
    },
    dot: { width: 7, height: 7, borderRadius: 4 },
    error: { color: '#D67B6B', fontSize: 13, lineHeight: 20 },
    debugCard: { borderTopWidth: 1, paddingTop: 20, gap: 8 },
    sectionTitle: { fontSize: 22, fontWeight: '600' },
    log: { fontFamily: 'monospace', fontSize: 11, lineHeight: 17 },
    scrim: { flex: 1, backgroundColor: '#00000088', justifyContent: 'flex-end' },
    sheet: {
        maxHeight: '92%',
        minHeight: '60%',
        borderTopLeftRadius: 26,
        borderTopRightRadius: 26,
    },
    sheetHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 24,
        paddingTop: 16,
        paddingBottom: 12,
    },
    sheetContent: {
        padding: 24,
        paddingTop: 8,
        paddingBottom: 48,
        gap: 16,
        maxWidth: 520,
        width: '100%',
        alignSelf: 'center',
    },
    toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
    packet: {
        padding: 18,
        borderRadius: 14,
        fontFamily: 'monospace',
        fontSize: 14,
        lineHeight: 23,
    },
});
