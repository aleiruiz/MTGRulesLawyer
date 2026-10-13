// "Judge's table": a dark table that reads well under game-store light. Brass is the only accent
// and marks actions; otherwise color only says how sure the judge is about a ruling.
export const colors = {
  background: "#0E1013",
  backgroundDeep: "#0B0C0F",
  surface: "#16191D",
  surfaceRaised: "#1E2227",
  surfaceSunken: "#14171A",
  border: "#2A2F36",
  divider: "#22262C",
  text: "#EDE9E2",
  textSoft: "#CFCAC2",
  textMuted: "#A39F97",
  textSubtle: "#8F8A82",
  accent: "#E0A33A",
  accentBright: "#F2BE63",
  accentSurface: "#2A2110",
  accentText: "#F2D9A6",
  /** Text on a brass fill. */
  accentInk: "#1A1206",
  /** The glowing lenses of the logo. */
  lens: "#F4EFE4",
  success: "#8FE0C2",
  successDot: "#5CC29B",
  successSurface: "#15302A",
  warning: "#F2C673",
  warningSurface: "#33270F",
  info: "#A9C6F7",
  infoDot: "#7AA7F0",
  infoSurface: "#182640",
  neutral: "#CFCAC2",
  neutralSurface: "#24272C",
  danger: "#F08A7A",
  dangerSurface: "#3A1A1C",
} as const;

export const fonts = {
  /** Verdicts and headings. */
  display: "Spectral_400Regular",
  displaySemibold: "Spectral_600SemiBold",
  displayItalic: "Spectral_400Regular_Italic",
  /** Everything people read and tap. */
  body: "InstrumentSans_400Regular",
  bodyMedium: "InstrumentSans_500Medium",
  bodySemibold: "InstrumentSans_600SemiBold",
  /** Rule numbers. */
  mono: "IBMPlexMono_400Regular",
  monoMedium: "IBMPlexMono_500Medium",
} as const;

/** Small uppercase section labels. */
export const eyebrow = {
  color: colors.textMuted,
  fontFamily: fonts.bodyMedium,
  fontSize: 12,
  letterSpacing: 1.2,
  textTransform: "uppercase",
} as const;
