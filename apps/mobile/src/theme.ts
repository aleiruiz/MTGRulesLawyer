// "Grimorio" palette: a dark spellbook with gold leaf and parchment. The five accent
// colors are plain fills chosen for the app; they are not Wizards mana symbol artwork.
export const colors = {
  background: "#14111d",
  backgroundDeep: "#0d0b13",
  backgroundGlow: "#2a2142",
  surface: "#1f1a2b",
  surfaceRaised: "#2a2240",
  border: "#3a3150",
  gold: "#c9a24a",
  goldBright: "#f3d58a",
  goldDeep: "#a87f2c",
  text: "#efe6cf",
  textMuted: "#bfb08a",
  textSubtle: "#8f8670",
  parchment: "#f2e9d2",
  ink: "#1c1408",
  inkMuted: "#6b5a3a",
  success: "#7fd39c",
  successSurface: "#1d3326",
  warning: "#f3c76e",
  warningSurface: "#3a2e14",
  info: "#9cc7ef",
  infoSurface: "#172a3d",
  danger: "#f08a7e",
  dangerSurface: "#3a1a1c",
} as const;

export const accentPips = ["#f4eed6", "#3b82c4", "#6f5a96", "#d2492f", "#2f8a4e"] as const;

export const fonts = {
  display: "Cinzel_700Bold",
  displayHeavy: "Cinzel_800ExtraBold",
  serif: "CormorantGaramond_600SemiBold",
  serifItalic: "CormorantGaramond_500Medium_Italic",
} as const;
