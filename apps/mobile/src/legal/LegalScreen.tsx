import { ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Text from "../ui/Text";
import { colors, eyebrow, fonts } from "../theme";
import { useT } from "../i18n/LanguageProvider";
import { legalDocuments, type LegalDocumentKind } from "./documents";

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
          <Text key={section.heading} style={styles.section}>
            <Text accessibilityRole="header" style={eyebrow}>
              {section.heading}
            </Text>
            {section.paragraphs.map((paragraph) => `\n\n${paragraph}`).join("")}
          </Text>
        ))}
      </ScrollView>
    </SafeAreaView>
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
  section: { fontSize: 15, lineHeight: 22 },
});
