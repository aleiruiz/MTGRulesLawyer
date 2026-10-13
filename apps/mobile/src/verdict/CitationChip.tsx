import { Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { RulingGenerationResponse } from "@mtg-rules/contracts";
import Text from "../ui/Text";
import { colors, fonts } from "../theme";

export type Citation = RulingGenerationResponse["citations"][number];

/** What a citation is called on its chip: a rule number, a card name or "Official ruling". */
export function citationChipLabel(citation: Citation): string {
  if (citation.kind === "CARD_RULING") return "Official ruling";
  return citation.label;
}

export function citationKindTitle(citation: Citation): string {
  if (citation.kind === "RULE") return "Comprehensive Rules";
  if (citation.kind === "CARD_FACE") return "Card text";
  return "Official ruling";
}

interface CitationChipProps {
  citation: Citation;
  onPress: () => void;
  /** The summary's chips are a little larger than a step's. */
  prominent?: boolean;
}

export default function CitationChip({ citation, onPress, prominent }: CitationChipProps) {
  const label = citationChipLabel(citation);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${citationKindTitle(citation)} ${label}`}
      accessibilityHint="Shows the cited text."
      hitSlop={{ top: 8, bottom: 8 }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        prominent && styles.prominent,
        pressed && styles.pressed,
      ]}
    >
      {citation.kind === "CARD_FACE" ? (
        <Ionicons name="tablet-portrait-outline" size={11} color={colors.textSoft} />
      ) : null}
      {citation.kind === "CARD_RULING" ? (
        <Ionicons name="bookmark-outline" size={11} color={colors.textSoft} />
      ) : null}
      <Text
        numberOfLines={1}
        style={[
          styles.text,
          citation.kind === "RULE" && styles.rule,
          prominent && styles.prominentText,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    height: 28,
    maxWidth: 220,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    borderRadius: 7,
    backgroundColor: colors.divider,
  },
  prominent: {
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: colors.neutralSurface,
  },
  pressed: { opacity: 0.7 },
  text: { color: colors.textSoft, fontSize: 12 },
  rule: { fontFamily: fonts.mono },
  prominentText: { color: colors.text },
});
