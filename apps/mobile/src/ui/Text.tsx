import { createContext, useContext } from "react";
import { Text as NativeText, Platform, StyleSheet, type TextProps } from "react-native";
import { colors } from "../theme";
import { FontsReadyContext } from "./fonts-ready";

const InsideText = createContext(false);

// Text that defaults to the theme's readable color on dark surfaces. Nested text skips the
// default so it keeps inheriting its parent's color, as React Native text normally does.
export default function Text({ style, ...props }: TextProps) {
  const nested = useContext(InsideText);
  const fontsReady = useContext(FontsReadyContext);
  const themed = nested ? style : [styles.base, style];
  // Until custom fonts load, render with the system font; see FontsReadyContext.
  const resolved = fontsReady ? themed : [themed, styles.systemFont];
  return (
    <InsideText.Provider value>
      <NativeText {...props} style={resolved} />
    </InsideText.Provider>
  );
}

const styles = StyleSheet.create({
  base: { color: colors.text },
  systemFont: { fontFamily: Platform.select({ ios: "System", default: "sans-serif" }) },
});
