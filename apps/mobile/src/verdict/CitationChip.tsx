import { Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Text from "../ui/Text";
import { colors, fonts } from "../theme";
import { strings } from "../i18n/core";
import { citationChipLabel, type Citation } from "./citation-labels";

export { citationChipLabel, citationChipLabels, type Citation } from "./citation-labels";

export function citationKindTitle(citation: Citation): string {
  return strings().citation.kinds[citation.kind];
}

interface CitationChipProps {
  citation: Citation;
  /** Overrides the chip's own label, e.g. to number repeated ones. */
  label?: string;
  onPress: () => void;
  /** The summary's chips are a little larger than a step's. */
  prominent?: boolean;
}

export default function CitationChip({
  citation,
  label = citationChipLabel(citation),
  onPress,
  prominent,
}: CitationChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${citationKindTitle(citation)} ${label}`}
      accessibilityHint={strings().citation.hint}
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
