import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { accentPips, colors } from "../theme";

interface ManaLoaderProps {
  accessibilityLabel: string;
  size?: number;
}

// Five color pips that light up in turn. Used wherever the app waits on the server.
export default function ManaLoader({ accessibilityLabel, size = 14 }: ManaLoaderProps) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: accentPips.length,
        duration: 1600,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [progress]);

  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="progressbar"
      style={[styles.row, { gap: size / 2 }]}
    >
      {accentPips.map((color, index) => {
        const opacity = progress.interpolate({
          inputRange: [index - 1, index, index + 1, index + 2],
          outputRange: [0.25, 1, 0.45, 0.25],
          extrapolate: "clamp",
        });
        const scale = progress.interpolate({
          inputRange: [index - 1, index, index + 1],
          outputRange: [0.85, 1.15, 0.85],
          extrapolate: "clamp",
        });
        return (
          <Animated.View
            key={color}
            style={[
              styles.pip,
              {
                width: size,
                height: size,
                borderRadius: size / 2,
                backgroundColor: color,
                opacity,
                transform: [{ scale }],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  pip: { borderWidth: 1, borderColor: colors.border },
});
