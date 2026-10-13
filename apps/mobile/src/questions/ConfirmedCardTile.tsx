import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Text from "../ui/Text";
import CardImage from "../cards/CardImage";
import type { CardLookupResponse } from "@mtg-rules/contracts";
import { colors, fonts } from "../theme";

type Card = CardLookupResponse["cards"][number];

// Scryfall "normal" images are 488×680.
const CARD_WIDTH = 150;
const CARD_HEIGHT = Math.round((CARD_WIDTH * 680) / 488);

interface ConfirmedCardTileProps {
  card: Card;
  copyCount: number;
  faceIndex: number;
  onSwitchFace: () => void;
  onChangeCount: (delta: number) => void;
  onReplace: () => void;
  onRemove: () => void;
}

/** A card on the table: its Scryfall image, shown as printed, and what the player can change. */
export default function ConfirmedCardTile({
  card,
  copyCount,
  faceIndex,
  onSwitchFace,
  onChangeCount,
  onReplace,
  onRemove,
}: ConfirmedCardTileProps) {
  const face =
    card.faces.find((candidate) => candidate.faceIndex === faceIndex) ?? card.matchedFace;
  const imageUri = face.imageUri ?? card.matchedFace.imageUri;

  return (
    <View style={styles.tile}>
      {imageUri ? (
        <CardImage
          accessibilityLabel={`${face.name}: ${face.typeLine}. ${face.oracleText}`}
          uri={imageUri}
          style={styles.image}
        />
      ) : (
        <View
          accessible
          accessibilityLabel={`${face.name}: ${face.typeLine}. ${face.oracleText}`}
          style={[styles.image, styles.textCard]}
        >
          <Text style={styles.textCardName}>{face.name}</Text>
          <Text style={styles.textCardType}>{face.typeLine}</Text>
          <Text numberOfLines={7} style={styles.textCardOracle}>
            {face.oracleText}
          </Text>
          {face.power !== null && face.toughness !== null ? (
            <Text style={styles.textCardStats}>
              {face.power}/{face.toughness}
            </Text>
          ) : null}
        </View>
      )}

      {card.faces.length > 1 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Switch face for ${card.name}; currently ${face.name}`}
          onPress={onSwitchFace}
          style={({ pressed }) => [styles.faceButton, pressed && styles.pressed]}
        >
          <Ionicons name="sync-outline" size={14} color={colors.textSoft} />
          <Text style={styles.faceText}>Other face</Text>
        </Pressable>
      ) : null}

      <View style={styles.stepper}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Fewer copies of ${card.name}`}
          accessibilityState={{ disabled: copyCount <= 1 }}
          disabled={copyCount <= 1}
          hitSlop={4}
          onPress={() => onChangeCount(-1)}
          style={({ pressed }) => [
            styles.stepButton,
            copyCount <= 1 && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons name="remove" size={16} color={colors.text} />
        </Pressable>
        <Text accessibilityLabel={`${copyCount} copies`} style={styles.count}>
          ×{copyCount}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`More copies of ${card.name}`}
          hitSlop={4}
          onPress={() => onChangeCount(1)}
          style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]}
        >
          <Ionicons name="add" size={16} color={colors.text} />
        </Pressable>
      </View>

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Replace ${card.name}`}
          onPress={onReplace}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <Text style={styles.actionText}>Replace</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${card.name}`}
          onPress={onRemove}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <Text style={[styles.actionText, styles.removeText]}>Remove</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { width: CARD_WIDTH, gap: 8 },
  image: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  textCard: {
    gap: 6,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  textCardName: { fontFamily: fonts.bodySemibold, fontSize: 13 },
  textCardType: { color: colors.textMuted, fontSize: 11 },
  textCardOracle: { flex: 1, color: colors.textSoft, fontSize: 11, lineHeight: 15 },
  textCardStats: { alignSelf: "flex-end", fontFamily: fonts.bodySemibold, fontSize: 12 },
  faceButton: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
  },
  faceText: { color: colors.textSoft, fontSize: 13 },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
  },
  stepButton: { width: 44, height: 36, alignItems: "center", justifyContent: "center" },
  count: { fontFamily: fonts.bodyMedium, fontSize: 14 },
  actions: { flexDirection: "row", justifyContent: "space-between" },
  action: { minHeight: 36, justifyContent: "center", paddingHorizontal: 4 },
  actionText: { color: colors.accent, fontSize: 13 },
  removeText: { color: colors.textMuted },
  disabled: { opacity: 0.35 },
  pressed: { opacity: 0.7 },
});
