import { Linking, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import type { RulingGenerationResponse } from "@mtg-rules/contracts";
import Text from "../ui/Text";
import { colors, eyebrow, fonts } from "../theme";
import { citationChipLabel, citationKindTitle, type Citation } from "./CitationChip";
import { strings } from "../i18n/core";
import { parseRulingLabel } from "./citation-labels";

interface CitationSheetProps {
  ruling: RulingGenerationResponse;
  citationId: string | null;
  onSelect: (citationId: string) => void;
  onClose: () => void;
}

function usedIn(ruling: RulingGenerationResponse, citationId: string): string | null {
  const steps = ruling.reasoningSteps.flatMap((step, index) =>
    step.citationIds.includes(citationId) ? [index + 1] : [],
  );
  const parts = [
    steps.length > 0 ? strings().citation.steps(steps) : null,
    ruling.summaryCitationIds.includes(citationId) ? strings().citation.theAnswer : null,
  ].filter(Boolean);
  return parts.length > 0 ? strings().citation.usedIn(parts.filter((part) => part !== null)) : null;
}

function citationTitle(citation: Citation): string {
  if (citation.kind !== "CARD_RULING") return citationChipLabel(citation);
  const ruling = parseRulingLabel(citation.label);
  return ruling ? `${strings().citation.rulingFor(ruling.card)} (${ruling.date})` : citation.label;
}

// A bottom sheet with the exact text a citation points to, so a player can show it at the table.
export default function CitationSheet({
  ruling,
  citationId,
  onSelect,
  onClose,
}: CitationSheetProps) {
  const insets = useSafeAreaInsets();
  const citation = ruling.citations.find((item) => item.id === citationId);
  const others = ruling.citations.filter((item) => item.id !== citationId);
  const usage = citation ? usedIn(ruling, citation.id) : null;

  return (
    <Modal
      animationType="slide"
      transparent
      visible={Boolean(citation)}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={strings().citation.closeCitation}
        onPress={onClose}
        style={styles.backdrop}
      />
      {citation ? (
        <View
          accessibilityViewIsModal
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}
        >
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.kind}>{citationKindTitle(citation)}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={strings().common.close}
              onPress={onClose}
              style={styles.close}
            >
              <Ionicons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.content}>
            <Text
              accessibilityRole="header"
              style={[styles.title, citation.kind === "RULE" && styles.ruleTitle]}
            >
              {citationTitle(citation)}
            </Text>
            <View style={styles.quote}>
              <Text selectable style={styles.quoteText}>
                {citation.excerpt}
              </Text>
            </View>
            {usage ? <Text style={styles.usage}>{usage}</Text> : null}
            <Pressable
              accessibilityRole="link"
              onPress={() => void Linking.openURL(citation.sourceUrl)}
              style={styles.sourceLink}
            >
              <Ionicons name="open-outline" size={15} color={colors.accent} />
              <Text style={styles.sourceText}>{strings().citation.openSource}</Text>
            </Pressable>

            {others.length > 0 ? (
              <View style={styles.others}>
                <Text style={eyebrow}>{strings().citation.alsoCited}</Text>
                {others.map((item) => (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${citationKindTitle(item)} ${citationTitle(item)}`}
                    onPress={() => onSelect(item.id)}
                    style={({ pressed }) => [styles.otherRow, pressed && styles.pressed]}
                  >
                    <Text
                      numberOfLines={1}
                      style={[styles.otherLabel, item.kind === "RULE" && styles.mono]}
                    >
                      {item.kind === "RULE" ? item.label : citationKindTitle(item)}
                    </Text>
                    <Text numberOfLines={1} style={styles.otherText}>
                      {item.kind === "RULE" ? item.excerpt : citationTitle(item)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </ScrollView>
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(5, 6, 8, 0.6)" },
  sheet: {
    maxHeight: "78%",
    paddingHorizontal: 20,
    paddingTop: 10,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  kind: { ...eyebrow },
  close: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginRight: -10,
  },
  content: { gap: 14, paddingBottom: 8 },
  title: { fontFamily: fonts.display, fontSize: 24, lineHeight: 30 },
  ruleTitle: { fontFamily: fonts.monoMedium, fontSize: 22 },
  quote: { paddingLeft: 14, borderLeftWidth: 2, borderLeftColor: colors.accent },
  quoteText: { color: colors.text, fontSize: 15.5, lineHeight: 23 },
  usage: { color: colors.textMuted, fontSize: 13 },
  sourceLink: {
    alignSelf: "flex-start",
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  sourceText: { color: colors.accent, fontSize: 14 },
  others: { gap: 2, paddingTop: 6 },
  otherRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  otherLabel: { width: 96, color: colors.textSoft, fontSize: 12.5 },
  mono: { fontFamily: fonts.mono },
  otherText: { flex: 1, color: colors.textMuted, fontSize: 13 },
  pressed: { opacity: 0.7 },
});
