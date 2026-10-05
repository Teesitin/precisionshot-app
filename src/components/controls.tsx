import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

export const palettes = {
    DARK: {
        background: '#101C20',
        surface: '#1C2B30',
        line: '#34484E',
        text: '#F4F1E9',
        muted: '#A1B2B6',
        accent: '#F0BA62',
        onAccent: '#172328',
    },
    LIGHT: {
        background: '#F5F3ED',
        surface: '#FFFFFF',
        line: '#DADFD9',
        text: '#182E32',
        muted: '#637A7E',
        accent: '#A96B1C',
        onAccent: '#FFFFFF',
    },
};
export type Palette = typeof palettes.DARK;

// Reuse the same buttons in training and settings.
export function Action({
    label,
    accessibilityLabel,
    onPress,
    disabled = false,
    primary = false,
    colors,
    style,
}: {
    label: string;
    accessibilityLabel?: string;
    onPress: () => void;
    disabled?: boolean;
    primary?: boolean;
    colors: Palette;
    style?: ViewStyle;
}) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel ?? label}
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={onPress}
            style={({ pressed }) => [
                styles.button,
                {
                    backgroundColor: primary ? colors.accent : colors.surface,
                    borderColor: primary ? colors.accent : colors.line,
                    opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
                },
                style,
            ]}
        >
            <Text style={[styles.buttonText, { color: primary ? colors.onAccent : colors.text }]}>
                {label}
            </Text>
        </Pressable>
    );
}

export function SettingRow({
    label,
    value,
    minus,
    plus,
    disabled,
    colors,
}: {
    label: string;
    value: string;
    minus: () => void;
    plus: () => void;
    disabled: boolean;
    colors: Palette;
}) {
    return (
        <View style={[styles.settingRow, { borderColor: colors.line }]}>
            <View style={styles.rowLabel}>
                <Text style={[styles.label, { color: colors.muted }]}>{label}</Text>
                <Text style={[styles.value, { color: colors.text }]}>{value}</Text>
            </View>
            <Action
                label="−"
                accessibilityLabel={`Decrease ${label.toLowerCase()}`}
                onPress={minus}
                disabled={disabled}
                colors={colors}
                style={styles.step}
            />
            <Action
                label="+"
                accessibilityLabel={`Increase ${label.toLowerCase()}`}
                onPress={plus}
                disabled={disabled}
                colors={colors}
                style={styles.step}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    button: {
        minHeight: 48,
        borderRadius: 14,
        borderWidth: 1,
        paddingHorizontal: 17,
        paddingVertical: 13,
        alignItems: 'center',
        justifyContent: 'center',
    },
    buttonText: { fontSize: 14, fontWeight: '600', textAlign: 'center' },
    settingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderBottomWidth: 1,
        paddingVertical: 18,
    },
    rowLabel: { flex: 1 },
    label: { fontSize: 13 },
    value: { fontSize: 24, fontWeight: '600', marginTop: 6 },
    step: { width: 48, paddingHorizontal: 7 },
});
