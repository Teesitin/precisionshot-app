import { StyleSheet, Text, View } from 'react-native';

// The board sends scores, but it does not send sensor positions yet.
export function Target({ size }: { size: number }) {
    return (
        <View
            accessibilityRole="image"
            accessibilityLabel="Ten-ring shooting target"
            style={[styles.target, { width: size, height: size }]}
        >
            {Array.from({ length: 10 }, (_, index) => {
                const diameter = (size * (10 - index)) / 10;
                return (
                    <View
                        key={index}
                        style={[
                            styles.ring,
                            {
                                width: diameter,
                                height: diameter,
                                borderRadius: diameter / 2,
                                backgroundColor:
                                    index < 4 ? '#EEECE3' : index === 9 ? '#EFB96A' : '#24373B',
                                borderColor: index < 4 ? '#83918A' : '#A0AAA4',
                            },
                        ]}
                    />
                );
            })}
            <View style={[styles.cross, { width: size * 0.15, height: 1 }]} />
            <View style={[styles.cross, { width: 1, height: size * 0.15 }]} />
            {[2, 4, 6, 8].map((score) => (
                <Text
                    key={score}
                    style={[
                        styles.number,
                        {
                            top: (size * (score - 0.5)) / 20 - 5,
                            color: score <= 4 ? '#4B5D59' : '#CFD5CF',
                        },
                    ]}
                >
                    {score}
                </Text>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    target: { alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
    ring: { position: 'absolute', borderWidth: 1 },
    cross: { position: 'absolute', backgroundColor: '#3C443C' },
    number: { position: 'absolute', fontSize: 10, fontWeight: '600' },
});
