import { Platform, Pressable, StyleSheet, View } from "react-native";
import { Link } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Text from "../ui/Text";
import { colors } from "../theme";
import { useT } from "../i18n/LanguageProvider";

/** The project's Ko-fi page. Leave null to hide the link. */
export const KOFI_URL: string | null = "https://ko-fi.com/aleiruiz";

/**
 * A quiet donation link on the account screen. The app stays free; donations only cover the
 * server and AI costs. Shown on the web only, because app stores have their own rules for
 * payments made from inside a native app.
 */
export default function SupportLink() {
  const { t } = useT();
  if (!KOFI_URL || Platform.OS !== "web") return null;
  const url = KOFI_URL;
  return (
    // A real anchor on the web, like the legal links, so it can be middle-clicked or copied.
    <Link href={url} target="_blank" rel="noopener noreferrer" asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={t.support.title}
        accessibilityHint={t.support.detail}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <Ionicons name="cafe-outline" size={18} color={colors.textSoft} />
        <View style={styles.text}>
          <Text style={styles.title}>{t.support.title}</Text>
          <Text style={styles.detail}>{t.support.detail}</Text>
        </View>
        <Ionicons name="open-outline" size={16} color={colors.textMuted} />
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.divider,
  },
  text: { flex: 1, gap: 2 },
  title: { fontSize: 15 },
  detail: { color: colors.textMuted, fontSize: 12.5 },
  pressed: { opacity: 0.75 },
});
