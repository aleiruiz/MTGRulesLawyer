import { Linking, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Text from "../ui/Text";
import { colors, eyebrow, fonts } from "../theme";
import { useT } from "../i18n/LanguageProvider";
import { LEGAL_CONTACT_URL, legalDocuments, type LegalDocumentKind } from "./documents";

/** A plain, readable page for the privacy policy or terms, in the current language. */
export default function LegalScreen({ kind }: { kind: LegalDocumentKind }) {
  const { language } = useT();
  const document = legalDocuments[kind][language];
  return (
    <SafeAreaView edges={["bottom", "left", "right"]} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.page}>
        <Text accessibilityRole="header" style={styles.title}>
          {document.title}
        </Text>
        <Text style={styles.updated}>{document.updated}</Text>
        {document.sections.map((section) => (
          <View key={section.heading} style={styles.section}>
            <Text accessibilityRole="header" style={eyebrow}>
              {section.heading}
            </Text>
            {section.paragraphs.map((paragraph) => (
              <Paragraph key={paragraph} text={paragraph} />
            ))}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

// The contact address is the only link in the documents; make it tappable where it appears.
function Paragraph({ text }: { text: string }) {
  const [before, after] = text.split(LEGAL_CONTACT_URL);
  if (after === undefined) return <Text style={styles.paragraph}>{text}</Text>;
  return (
    <Text style={styles.paragraph}>
      {before}
      <Text
        accessibilityRole="link"
        onPress={() => void Linking.openURL(LEGAL_CONTACT_URL)}
        style={styles.link}
      >
        {LEGAL_CONTACT_URL}
      </Text>
      {after}
    </Text>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  page: {
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 28,
    gap: 20,
  },
  title: { fontFamily: fonts.display, fontSize: 28, lineHeight: 34 },
  updated: { color: colors.textSubtle, fontSize: 13 },
  section: { gap: 12 },
  paragraph: { fontSize: 15, lineHeight: 22 },
  link: { color: colors.accent, textDecorationLine: "underline" },
});
