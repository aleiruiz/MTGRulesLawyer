import { useEffect, useRef } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from "react-native";
import { colors } from "../theme";

interface LoaderProps {
  accessibilityLabel: string;
  size?: number;
  /** Defaults to brass; pass the ink color on a brass button. */
  color?: string;
}

const DOTS = [0, 1, 2];

// Three brass dots that brighten in turn. Used wherever the app waits on the server.
export default function Loader({
  accessibilityLabel,
  size = 10,
  color = colors.accent,
}: LoaderProps) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let loop: Animated.CompositeAnimation | undefined;
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduceMotion) => {
      if (cancelled || reduceMotion) return;
      loop = Animated.loop(
        Animated.timing(progress, {
          toValue: DOTS.length,
          duration: 1200,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      );
      loop.start();
    });
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [progress]);

  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="progressbar"
      style={[styles.row, { gap: size * 0.6 }]}
    >
      {DOTS.map((index) => {
        const opacity = progress.interpolate({
          inputRange: [index - 1, index, index + 1, index + 2],
          outputRange: [0.3, 1, 0.45, 0.3],
          extrapolate: "clamp",
        });
        return (
          <Animated.View
            key={index}
            style={{
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: color,
              opacity,
            }}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
});
