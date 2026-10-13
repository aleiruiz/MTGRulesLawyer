import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, StyleSheet } from "react-native";
import { colors } from "../theme";
import { useT } from "../i18n/LanguageProvider";

// A screen opened straight from a URL (page reload, sign-in return, shared link) has no
// history, so the stack shows no back button. This one goes home instead. With history it
// goes back; the root layout only uses it for that on web, where it replaces the default.
export default function HeaderNavButton({ canGoBack }: { canGoBack: boolean | undefined }) {
  const { t } = useT();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={canGoBack ? t.headerNav.back : t.headerNav.home}
      hitSlop={8}
      onPress={() => (canGoBack ? router.back() : router.replace("/"))}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Ionicons name="chevron-back" size={24} color={colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { width: 40, height: 40, alignItems: "center", justifyContent: "center", marginLeft: 4 },
  pressed: { opacity: 0.6 },
});
