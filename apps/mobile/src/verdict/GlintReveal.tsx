import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import Text from "../ui/Text";
import { colors, fonts } from "../theme";
import useReduceMotion from "../ui/useReduceMotion";
import { useT } from "../i18n/LanguageProvider";

// The mark is drawn in a 120×66 box (the glasses plus room for the finger) at twice the size.
const SCALE = 2;
const WIDTH = 120 * SCALE;
const HEIGHT = 66 * SCALE;
const DURATION_MS = 2000;
const LENSES = [13, 67].map((x) => ({ left: x * SCALE, top: 24 * SCALE }));
const LENS_WIDTH = 40 * SCALE;
const LENS_HEIGHT = 24 * SCALE;
const LENS_RADIUS = 9 * SCALE;

interface GlintRevealProps {
  /** Called once the animation has played, so the verdict can take its place. */
  onDone: () => void;
}

// The "well, actually" moment when a ruling arrives: a finger pushes up the glasses, the lenses
// light up, a shine sweeps across them and a sparkle pops.
export default function GlintReveal({ onDone }: GlintRevealProps) {
  const { t } = useT();
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (reduceMotion === null) return undefined;
    if (reduceMotion) {
      progress.setValue(1);
      const timer = setTimeout(() => onDoneRef.current(), 700);
      return () => clearTimeout(timer);
    }
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: DURATION_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished) onDoneRef.current();
    });
    return () => animation.stop();
  }, [progress, reduceMotion]);

  const fingerY = progress.interpolate({
    inputRange: [0, 0.1, 0.28, 1],
    outputRange: [10 * SCALE, 10 * SCALE, 0, 0],
  });
  const darkLens = progress.interpolate({
    inputRange: [0, 0.24, 0.34, 1],
    outputRange: [1, 1, 0, 0],
  });
  const sweepX = progress.interpolate({
    inputRange: [0, 0.3, 0.52, 1],
    outputRange: [-46 * SCALE, -46 * SCALE, 46 * SCALE, 46 * SCALE],
  });
  const sparkOpacity = progress.interpolate({
    inputRange: [0, 0.42, 0.52, 0.9, 1],
    outputRange: [0, 0, 1, 1, 0.9],
  });
  const sparkScale = progress.interpolate({
    inputRange: [0, 0.42, 0.52, 0.64, 1],
    outputRange: [0.3, 0.3, 1.2, 1, 1],
  });
  const sparkRotate = progress.interpolate({
    inputRange: [0, 0.42, 0.52, 0.64, 1],
    outputRange: ["0deg", "0deg", "25deg", "40deg", "40deg"],
  });
  const caption = progress.interpolate({
    inputRange: [0, 0.4, 0.6, 1],
    outputRange: [0, 0, 1, 1],
  });

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={t.reveal.label}
      style={styles.wrap}
    >
      <View style={styles.stage}>
        <Svg style={styles.layer} width={WIDTH} height={HEIGHT} viewBox="0 0 120 66">
          <Path
            d="M13 31 3 28M107 31l10-3"
            stroke={colors.accent}
            strokeWidth={2.4}
            strokeLinecap="round"
          />
          <Rect x={13} y={24} width={40} height={24} rx={9} fill={colors.lens} />
          <Rect x={67} y={24} width={40} height={24} rx={9} fill={colors.lens} />
        </Svg>
        {LENSES.map((lens) => (
          <View key={lens.left} style={[styles.lens, { left: lens.left, top: lens.top }]}>
            <Animated.View style={[styles.darkLens, { opacity: darkLens }]} />
            <Animated.View style={[styles.sweep, { transform: [{ translateX: sweepX }] }]} />
          </View>
        ))}
        <Svg style={styles.layer} width={WIDTH} height={HEIGHT} viewBox="0 0 120 66">
          <Rect
            x={13}
            y={24}
            width={40}
            height={24}
            rx={9}
            fill="none"
            stroke={colors.accent}
            strokeWidth={2.8}
          />
          <Rect
            x={67}
            y={24}
            width={40}
            height={24}
            rx={9}
            fill="none"
            stroke={colors.accent}
            strokeWidth={2.8}
          />
          <Path
            d="M53 31q7-5 14 0"
            stroke={colors.accent}
            strokeWidth={2.8}
            fill="none"
            strokeLinecap="round"
          />
        </Svg>
        <Animated.View style={[styles.layer, { transform: [{ translateY: fingerY }] }]}>
          <Svg width={WIDTH} height={HEIGHT} viewBox="0 0 120 66">
            <Path
              d="M54.5 66V36a5.5 5.5 0 0 1 11 0v30"
              fill={colors.surface}
              stroke={colors.text}
              strokeWidth={2}
              strokeLinejoin="round"
            />
            <Path
              d="M57.5 38.5a2.6 2.6 0 0 1 5 0v3.5h-5z"
              fill="none"
              stroke={colors.textMuted}
              strokeWidth={1.2}
              strokeLinejoin="round"
            />
          </Svg>
        </Animated.View>
        <Animated.View
          style={[
            styles.spark,
            {
              opacity: sparkOpacity,
              transform: [{ scale: sparkScale }, { rotate: sparkRotate }],
            },
          ]}
        >
          <Svg width={16 * SCALE} height={16 * SCALE} viewBox="96 9 16 16">
            <Path
              d="M104 9 105.8 15.2 112 17 105.8 18.8 104 25 102.2 18.8 96 17 102.2 15.2z"
              fill="#FFFFFF"
            />
          </Svg>
        </Animated.View>
      </View>
      <Animated.View style={{ opacity: caption }}>
        <Text style={styles.caption}>{t.reveal.actually}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: 10, paddingVertical: 18 },
  stage: { width: WIDTH, height: HEIGHT },
  layer: { position: "absolute", left: 0, top: 0, width: WIDTH, height: HEIGHT },
  lens: {
    position: "absolute",
    width: LENS_WIDTH,
    height: LENS_HEIGHT,
    borderRadius: LENS_RADIUS,
    overflow: "hidden",
  },
  darkLens: { ...StyleSheet.absoluteFillObject, backgroundColor: "#3A4048" },
  sweep: {
    position: "absolute",
    left: 15 * SCALE,
    top: -4 * SCALE,
    width: 7 * SCALE,
    height: 34 * SCALE,
    backgroundColor: "#FFFFFF",
    opacity: 0.85,
  },
  spark: { position: "absolute", left: 96 * SCALE, top: 9 * SCALE },
  caption: { color: colors.accentText, fontFamily: fonts.displayItalic, fontSize: 22 },
});
