import { StyleSheet, View } from "react-native";
import { Link } from "expo-router";
import Text from "../ui/Text";
import { colors } from "../theme";
import { useT } from "../i18n/LanguageProvider";

/** Privacy and terms links; real anchors on the web so reviewers and crawlers can follow them. */
export default function LegalLinks() {
  const { t } = useT();
  return (
    <View style={styles.row}>
      {(["privacy", "terms"] as const).map((page) => (
        <Link key={page} href={`/${page}`} style={styles.link}>
          <Text style={styles.text}>{t.titles[page]}</Text>
        </Link>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 20 },
  link: { minHeight: 44, justifyContent: "center", paddingVertical: 12 },
  text: { color: colors.textMuted, fontSize: 13, textDecorationLine: "underline" },
});
