import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from "react-native";
import { colors } from "../theme";

interface LoaderProps {
  accessibilityLabel: string;
  size?: number;
  /** Defaults to brass; pass the ink color on a brass button. */
  color?: string;
}

const DOTS = [0, 1, 2];
// One dot rises and brightens at a time; the next starts as it settles, so one is always lit.
const STEP_MS = 260;
const CYCLE_MS = STEP_MS * (DOTS.length + 1);

// Three brass dots that rise and brighten in turn. Used wherever the app waits on the server.
// With reduce motion on they only fade, which still shows the app is working.
export default function Loader({
  accessibilityLabel,
  size = 10,
  color = colors.accent,
}: LoaderProps) {
  const pulses = useRef(DOTS.map(() => new Animated.Value(0))).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (!cancelled) setReduceMotion(enabled);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.parallel(
        pulses.map((pulse, index) =>
          Animated.sequence([
            Animated.delay(index * STEP_MS),
            Animated.timing(pulse, {
              toValue: 1,
              duration: STEP_MS,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(pulse, {
              toValue: 0,
              duration: STEP_MS,
              easing: Easing.in(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.delay(CYCLE_MS - (index + 2) * STEP_MS),
          ]),
        ),
      ),
    );
    loop.start();
    return () => loop.stop();
  }, [pulses]);

  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="progressbar"
      style={[styles.row, { gap: size * 0.6 }]}
    >
      {pulses.map((pulse, index) => (
        <Animated.View
          key={index}
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: color,
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }),
            transform: reduceMotion
              ? []
              : [
                  {
                    translateY: pulse.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, -size * 0.5],
                    }),
                  },
                ],
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
});
