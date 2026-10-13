import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import Svg, { Circle, G, Path, Rect } from "react-native-svg";
import { colors } from "../theme";
import useReduceMotion from "./useReduceMotion";
import { useT } from "../i18n/LanguageProvider";

const WIDTH = 220;
const HEIGHT = 200;
// The table edge. The hand is clipped just above it so it rises from behind the table.
const TABLE_Y = 167;
const CYCLE_MS = 2600;

const HAND =
  "M92 166 L92 146 C84 140 78 130 74 120 L70 111 A5.5 5.5 0 0 1 79.5 105.5 L88 116 L88 80 " +
  "A5.5 5.5 0 0 1 99 80 L99 96 Q100 99 101 96 L101 70 A5.5 5.5 0 0 1 112 70 L112 96 " +
  "Q113 99 114 96 L114 76 A5.5 5.5 0 0 1 125 76 L125 98 Q126 101 127 98 L127 88 " +
  "A5 5 0 0 1 137 88 L137 116 C137 132 127 142 126 154 L126 166 Z";

// A player raises a hand at the table and waves to call a judge, while a "!" bubble pops.
export default function RaisedHand() {
  const { t } = useT();
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (reduceMotion !== false) return undefined;
    progress.setValue(0);
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: CYCLE_MS,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => {
      loop.stop();
      // Rest in the raised pose rather than freezing mid-wave.
      progress.setValue(1);
    };
  }, [progress, reduceMotion]);

  const rise = progress.interpolate({
    inputRange: [0, 0.12, 0.38, 1],
    outputRange: [46, 46, 0, 0],
  });
  const wave = progress.interpolate({
    inputRange: [0, 0.38, 0.5, 0.62, 0.74, 0.88, 1],
    outputRange: ["0deg", "0deg", "-7deg", "5deg", "-4deg", "0deg", "0deg"],
  });
  const bubbleOpacity = progress.interpolate({
    inputRange: [0, 0.36, 0.46, 0.88, 1],
    outputRange: [0, 0, 1, 1, 0],
  });
  const bubbleScale = progress.interpolate({
    inputRange: [0, 0.36, 0.46, 0.56, 1],
    outputRange: [0.6, 0.6, 1.08, 1, 1],
  });

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={t.splash.hand}
      style={styles.stage}
    >
      <View style={styles.handClip}>
        <Animated.View
          style={[
            styles.layer,
            {
              transformOrigin: "107px 166px",
              transform: [{ translateY: rise }, { rotate: wave }],
            },
          ]}
        >
          <Svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
            <Path
              d={HAND}
              fill={colors.surface}
              stroke={colors.text}
              strokeWidth={2.2}
              strokeLinejoin="round"
            />
            <Rect
              x={87}
              y={154}
              width={44}
              height={14}
              rx={3}
              fill={colors.border}
              stroke={colors.text}
              strokeWidth={2}
            />
          </Svg>
        </Animated.View>
      </View>
      <Animated.View
        style={[
          styles.layer,
          {
            opacity: bubbleOpacity,
            transformOrigin: "150px 40px",
            transform: [{ scale: bubbleScale }],
          },
        ]}
      >
        <Svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
          <Circle
            cx={150}
            cy={40}
            r={17}
            fill={colors.accentSurface}
            stroke={colors.accent}
            strokeWidth={1.8}
          />
          <Path
            d="M150 31v11M150 47.5v.5"
            stroke={colors.accent}
            strokeWidth={2.6}
            strokeLinecap="round"
          />
        </Svg>
      </Animated.View>
      <Svg style={styles.layer} width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
        <Path
          d="M20 168h68M130 168h70"
          stroke={colors.border}
          strokeWidth={2}
          strokeLinecap="round"
        />
        <G transform="translate(40 170) skewX(-18)">
          <Rect x={0} y={4} width={26} height={14} rx={2.5} fill={colors.surfaceRaised} />
          <Rect x={32} y={4} width={26} height={14} rx={2.5} fill={colors.surfaceRaised} />
        </G>
        <G transform="translate(138 170) skewX(18)">
          <Rect
            x={0}
            y={4}
            width={26}
            height={14}
            rx={2.5}
            fill={colors.surfaceRaised}
            stroke={colors.accent}
            strokeWidth={1.2}
          />
        </G>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { width: WIDTH, height: HEIGHT },
  handClip: {
    position: "absolute",
    left: 0,
    top: 0,
    width: WIDTH,
    height: TABLE_Y,
    overflow: "hidden",
  },
  layer: { position: "absolute", left: 0, top: 0, width: WIDTH, height: HEIGHT },
});
