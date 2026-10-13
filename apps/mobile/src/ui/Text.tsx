import { createContext, useContext } from "react";
import {
  Text as NativeText,
  Platform,
  StyleSheet,
  type TextProps,
  type TextStyle,
} from "react-native";
import { colors, fonts } from "../theme";
import { FontsReadyContext } from "./fonts-ready";

const InsideText = createContext(false);
const customFontFamilies = new Set<string>(Object.values(fonts));

// Text that defaults to the theme's readable color on dark surfaces. Nested text skips the
// default so it keeps inheriting its parent's color, as React Native text normally does.
export default function Text({ style, ...props }: TextProps) {
  const nested = useContext(InsideText);
  const fontsReady = useContext(FontsReadyContext);
  const themed = nested ? style : [styles.base, style];
  // Until the theme's fonts load, render them with the system font; see FontsReadyContext.
  // Other families (such as monospace) are left alone.
  const waitingForFont =
    !fontsReady && customFontFamilies.has(String(StyleSheet.flatten<TextStyle>(themed).fontFamily));
  return (
    <InsideText.Provider value>
      <NativeText {...props} style={waitingForFont ? [themed, styles.systemFont] : themed} />
    </InsideText.Provider>
  );
}

const styles = StyleSheet.create({
  base: { color: colors.text, fontFamily: fonts.body },
  systemFont: { fontFamily: Platform.select({ ios: "System", default: "sans-serif" }) },
});
