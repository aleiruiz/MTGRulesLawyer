import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import type { ChallengeResponse } from "@mtg-rules/contracts";
import Text from "../ui/Text";
import { colors, fonts } from "../theme";
import { challengeStatus } from "./challenge-status";
import { strings } from "../i18n/core";

/** One dispute in a list: the question and where its review stands. */
export default function ChallengeRow({ challenge }: { challenge: ChallengeResponse }) {
  const status = challengeStatus(challenge);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${challenge.question}. ${status.label}`}
      accessibilityHint={strings().disputes.openHint}
      onPress={() => router.push("/challenges")}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Text numberOfLines={1} style={styles.question}>
        {challenge.question}
      </Text>
      <View style={[styles.pill, { backgroundColor: status.background }]}>
        <Text numberOfLines={1} style={[styles.pillText, { color: status.color }]}>
          {status.label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  pressed: { opacity: 0.7 },
  question: { flex: 1, fontSize: 14.5 },
  pill: { maxWidth: "52%", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  pillText: { fontFamily: fonts.bodyMedium, fontSize: 12 },
});
