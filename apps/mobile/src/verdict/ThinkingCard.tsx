import { StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Text from "../ui/Text";
import Loader from "../ui/Loader";
import { colors, fonts } from "../theme";
import { useT } from "../i18n/LanguageProvider";

interface ThinkingCardProps {
  /** Names of the cards the judge was given. */
  cardNames: string[];
  /** A follow-up is first read for new cards before the judge looks at the rules. */
  reading?: boolean;
}

// What the player sees while a ruling is generated. It only lists steps that are really
// happening; the ruling request is a single call, so there is no fake progress.
export default function ThinkingCard({ cardNames, reading }: ThinkingCardProps) {
  const { t } = useT();
  return (
    <View style={styles.wrap}>
      <View
        style={styles.fan}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <View style={[styles.card, styles.back]} />
        <View style={[styles.card, styles.middle]} />
        <View style={[styles.card, styles.front]}>
          <Ionicons name="search" size={24} color={colors.accent} />
        </View>
      </View>
      <Text accessibilityRole="header" style={styles.title}>
        {reading ? t.thinking.readingQuestion : t.thinking.readingRules}
      </Text>
      <View style={styles.steps}>
        {cardNames.length > 0 && !reading ? (
          <View style={styles.step}>
            <Ionicons name="checkmark-circle" size={20} color={colors.successDot} />
            <View style={styles.stepText}>
              <Text style={styles.stepTitle}>{t.thinking.cardsConfirmed}</Text>
              <Text numberOfLines={2} style={styles.stepDetail}>
                {cardNames.join(", ")}
              </Text>
            </View>
          </View>
        ) : null}
        <View style={styles.step}>
          <View style={styles.loader}>
            <Loader accessibilityLabel={t.thinking.working} size={5} />
          </View>
          <View style={styles.stepText}>
            <Text style={styles.stepTitle}>
              {reading ? t.thinking.checkingCards : t.thinking.walking}
            </Text>
            <Text style={styles.stepDetail}>
              {reading ? t.thinking.thenRules : t.thinking.everyStep}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: 16, paddingVertical: 12 },
  fan: { width: 132, height: 118 },
  card: {
    position: "absolute",
    width: 62,
    height: 86,
    borderRadius: 7,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  back: {
    left: 22,
    top: 24,
    borderColor: "#3A4048",
    backgroundColor: colors.surfaceRaised,
    transform: [{ rotate: "-10deg" }],
  },
  middle: {
    left: 36,
    top: 16,
    borderColor: "#4A515A",
    backgroundColor: "#20242A",
    transform: [{ rotate: "-2deg" }],
  },
  front: {
    left: 50,
    top: 10,
    borderWidth: 1.5,
    borderColor: colors.accent,
    backgroundColor: "#262A30",
    transform: [{ rotate: "7deg" }],
  },
  title: { fontFamily: fonts.display, fontSize: 24, lineHeight: 30, textAlign: "center" },
  steps: {
    alignSelf: "stretch",
    gap: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.surface,
  },
  step: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  loader: { width: 20, height: 20, alignItems: "center", justifyContent: "center" },
  stepText: { flex: 1, gap: 2 },
  stepTitle: { fontSize: 14.5 },
  stepDetail: { color: colors.textMuted, fontSize: 12.5, lineHeight: 17 },
});
