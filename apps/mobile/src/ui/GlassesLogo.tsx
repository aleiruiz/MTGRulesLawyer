import Svg, { Path, Rect } from "react-native-svg";
import { colors } from "../theme";

interface GlassesLogoProps {
  /** Width in points; the height follows the mark's proportions. */
  width?: number;
  /** The small sparkle at the top right corner. */
  sparkle?: boolean;
}

// The Rules Lawyer mark: a pair of glasses whose lenses glint, the "well, actually" moment.
export default function GlassesLogo({ width = 44, sparkle = true }: GlassesLogoProps) {
  return (
    <Svg
      width={width}
      height={(width * 52) / 120}
      viewBox="0 0 120 52"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <Path
        d="M13 31 3 28M107 31l10-3"
        stroke={colors.accent}
        strokeWidth={5}
        strokeLinecap="round"
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
        fill={colors.lens}
        stroke={colors.accent}
        strokeWidth={5.5}
      />
      <Path
        d="M53 31q7-5 14 0"
        stroke={colors.accent}
        strokeWidth={5.5}
        fill="none"
        strokeLinecap="round"
      />
      {sparkle ? (
        <Path d="M104 5 107 15 117 18 107 21 104 31 101 21 91 18 101 15z" fill="#FFFFFF" />
      ) : null}
    </Svg>
  );
}
