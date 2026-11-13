import { StyleSheet, Text, View } from 'react-native';
import type { Palette } from '@/components/controls';

const sensors = Array.from({ length: 16 }, (_, index) => index + 1);

export function Target({
    size,
    highlightedSensor,
    highlightLabel,
    colors,
}: {
    size: number;
    highlightedSensor: number | null;
    highlightLabel: 'Cue' | 'Hit';
    colors: Palette;
}) {
    return (
        <View style={[styles.target, { width: size }]} accessibilityLabel="Sixteen target zones">
            {[0, 4, 8, 12].map((start) => (
                <View style={styles.row} key={start}>
                    {sensors.slice(start, start + 4).map((sensor) => {
                        const active = sensor === highlightedSensor;
                        return (
                            <View
                                key={sensor}
                                accessible
                                accessibilityLabel={`Zone ${sensor}${active ? `, ${highlightLabel} · PT${sensor}` : ''}`}
                                style={[
                                    styles.zone,
                                    {
                                        backgroundColor: active ? colors.accent : colors.surface,
                                        borderColor: active ? colors.accent : colors.line,
                                    },
                                ]}
                            >
                                <Text style={[styles.number, { color: active ? colors.onAccent : colors.text }]}>
                                    {String(sensor).padStart(2, '0')}
                                </Text>
                            </View>
                        );
                    })}
                </View>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    target: { alignSelf: 'center', gap: 10 },
    row: { flexDirection: 'row', gap: 10 },
    zone: {
        flex: 1,
        aspectRatio: 1,
        borderRadius: 999,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    number: { fontSize: 17, fontWeight: '700' },
});
