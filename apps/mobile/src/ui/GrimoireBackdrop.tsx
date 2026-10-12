import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet } from "react-native";
import { colors } from "../theme";

// A soft violet glow that fades into the page from the top of a screen.
export default function GrimoireBackdrop() {
  return (
    <LinearGradient
      pointerEvents="none"
      colors={[colors.backgroundGlow, colors.background]}
      locations={[0, 0.45]}
      style={StyleSheet.absoluteFill}
    />
  );
}
