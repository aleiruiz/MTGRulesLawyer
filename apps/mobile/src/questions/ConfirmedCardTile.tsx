import { Pressable, StyleSheet, View } from "react-native";
import Text from "../ui/Text";
import type { CardLookupResponse } from "@mtg-rules/contracts";
import { colors, fonts } from "../theme";

type Card = CardLookupResponse["cards"][number];

interface ConfirmedCardTileProps {
  card: Card;
  mentionCount: number;
  copyCount: number;
  faceIndex: number;
  onSwitchFace: () => void;
  onChangeCount: (delta: number) => void;
  onReplace: () => void;
  onRemove: () => void;
}

export default function ConfirmedCardTile({
  card,
  mentionCount,
  copyCount,
  faceIndex,
  onSwitchFace,
  onChangeCount,
  onReplace,
  onRemove,
}: ConfirmedCardTileProps) {
  const face =
    card.faces.find((candidate) => candidate.faceIndex === faceIndex) ?? card.matchedFace;

  return (
    <View style={styles.cardTile}>
      <Text style={styles.cardTitle}>{card.name}</Text>
      <Text style={styles.faceName}>{face.name}</Text>
      <Text numberOfLines={4} style={styles.oracleText}>
        {face.oracleText || face.typeLine}
      </Text>
      {card.faces.length > 1 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Switch face for ${card.name}; currently ${face.name}`}
          onPress={onSwitchFace}
          style={styles.secondaryButton}
        >
          <Text style={styles.secondaryButtonText}>Switch face</Text>
        </Pressable>
      ) : null}
      <Text
        accessibilityLabel={`${mentionCount} detected mentions, ${copyCount} copies`}
        style={styles.countText}
      >
        {mentionCount} mention{mentionCount === 1 ? "" : "s"} · {copyCount} cop
        {copyCount === 1 ? "y" : "ies"}
      </Text>
      <View style={styles.inlineButtons}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${card.name} copy count`}
          onPress={() => onChangeCount(-1)}
          style={styles.smallButton}
        >
          <Text style={styles.smallButtonText}>−</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Increase ${card.name} copy count`}
          onPress={() => onChangeCount(1)}
          style={styles.smallButton}
        >
          <Text style={styles.smallButtonText}>+</Text>
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Replace ${card.name}`}
        onPress={onReplace}
        style={styles.secondaryButton}
      >
        <Text style={styles.secondaryButtonText}>Replace card</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove ${card.name}`}
        onPress={onRemove}
        style={styles.removeButton}
      >
        <Text style={styles.removeButtonText}>Remove</Text>
      </Pressable>
      <Text selectable style={styles.oracleId}>
        Oracle ID: {card.oracleId}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cardTile: {
    width: 250,
    gap: 9,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: { color: colors.text, fontSize: 16, fontFamily: fonts.bodySemibold },
  faceName: { color: colors.text, fontFamily: fonts.bodySemibold },
  oracleText: { color: colors.text, minHeight: 52 },
  secondaryButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 9,
    backgroundColor: colors.surface,
  },
  secondaryButtonText: {
    color: colors.accent,
    fontSize: 14,
    fontFamily: fonts.bodySemibold,
    textAlign: "center",
  },
  countText: { textAlign: "center", color: colors.text, fontFamily: fonts.bodySemibold },
  inlineButtons: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  smallButton: {
    minWidth: 48,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: colors.successSurface,
  },
  smallButtonText: { color: colors.accent, fontSize: 24, fontFamily: fonts.bodySemibold },
  removeButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: colors.dangerSurface,
  },
  removeButtonText: { color: colors.danger, fontFamily: fonts.bodySemibold },
  oracleId: { color: colors.textMuted, fontSize: 11 },
});
