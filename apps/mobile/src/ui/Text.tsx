import { createContext, useContext } from "react";
import { Text as NativeText, StyleSheet, type TextProps } from "react-native";
import { colors } from "../theme";

const InsideText = createContext(false);

// Text that defaults to the theme's readable color on dark surfaces. Nested text skips the
// default so it keeps inheriting its parent's color, as React Native text normally does.
export default function Text({ style, ...props }: TextProps) {
  const nested = useContext(InsideText);
  return (
    <InsideText.Provider value>
      <NativeText {...props} style={nested ? style : [styles.base, style]} />
    </InsideText.Provider>
  );
}

const styles = StyleSheet.create({
  base: { color: colors.text },
});
