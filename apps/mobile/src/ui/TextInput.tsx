import { useContext } from "react";
import { TextInput as NativeTextInput, StyleSheet, type TextInputProps } from "react-native";
import { colors, fonts } from "../theme";
import { FontsReadyContext } from "./fonts-ready";

// Text input that types in the theme's body font once it has loaded, like Text.
export default function TextInput({ style, ...props }: TextInputProps) {
  const fontsReady = useContext(FontsReadyContext);
  return (
    <NativeTextInput
      placeholderTextColor={colors.textSubtle}
      {...props}
      style={fontsReady ? [styles.base, style] : style}
    />
  );
}

const styles = StyleSheet.create({
  base: { fontFamily: fonts.body },
});
