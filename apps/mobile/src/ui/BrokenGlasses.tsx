import Svg, { G, Path, Rect } from "react-native-svg";
import { colors } from "../theme";

interface BrokenGlassesProps {
  /** Width in points; the height follows the drawing's proportions. */
  width?: number;
}

// The logo after a bad call: one lens cracked, a temple bent and the bridge taped together.
// Shown where a player disputes a ruling.
export default function BrokenGlasses({ width = 96 }: BrokenGlassesProps) {
  return (
    <Svg
      width={width}
      height={(width * 60) / 124}
      viewBox="-2 -2 124 60"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <G transform="rotate(-7 60 36)">
        {/* Left temple as usual, right one bent down. */}
        <Path d="M13 31 3 28" stroke={colors.accent} strokeWidth={5} strokeLinecap="round" />
        <Path
          d="M107 31l7 3 3 7"
          stroke={colors.accent}
          strokeWidth={5}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <Rect
          x={13}
          y={24}
          width={40}
          height={24}
          rx={9}
          fill={colors.lens}
          stroke={colors.accent}
          strokeWidth={5.5}
        />
        <Rect
          x={67}
          y={24}
          width={40}
          height={24}
          rx={9}
          fill="#D9D2C2"
          stroke={colors.accent}
          strokeWidth={5.5}
        />
        {/* A shard knocked out of the right lens, and the cracks around it. */}
        <Path d="M88 34 99 27 103 33z" fill="#3A4048" />
        <Path
          d="M88 34 85 30 86 27 81 25M88 34 92 32 95 28 99 27M88 34 94 36 98 33 104 34M88 34 89 39 93 42 92 47M88 34 84 37 82 41 76 43M86 27l3-2M95 28l-1-3M98 33l1 4M93 42l4 1M82 41l-3-3"
          stroke="#6B6760"
          strokeWidth={1.3}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <Path
          d="M53 31q7-5 14 0"
          stroke={colors.accent}
          strokeWidth={5.5}
          fill="none"
          strokeLinecap="round"
        />
        {/* Tape around the bridge. */}
        <Rect
          x={55.5}
          y={23.5}
          width={9}
          height={11}
          rx={1.5}
          fill={colors.text}
          transform="rotate(8 60 29)"
        />
        <Path
          d="M57.5 26.5h5M57.5 29.5h5M57.5 32.5h5"
          stroke="#B8B2A8"
          strokeWidth={0.9}
          strokeLinecap="round"
          transform="rotate(8 60 29)"
        />
      </G>
    </Svg>
  );
}
