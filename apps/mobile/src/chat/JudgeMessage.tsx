import { useState } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { PersistedRulingResponse } from "@mtg-rules/contracts";
import ChallengeForm from "../challenges/ChallengeForm";
import { getPublicRulingUrl } from "../rulings/public-ruling-url";
import Text from "../ui/Text";
import { colors, fonts } from "../theme";

type Outcome = PersistedRulingResponse["ruling"]["outcome"];

const outcomeStyles: Record<Outcome, { label: string; color: string; background: string }> = {
  resolved: { label: "Ruling", color: colors.success, background: colors.successSurface },
  conditional: { label: "It depends", color: colors.warning, background: colors.warningSurface },
  needs_information: {
    label: "Need more details",
    color: colors.info,
    background: colors.infoSurface,
  },
  uncertain: { label: "Not certain", color: colors.danger, background: colors.dangerSurface },
};

export function outcomeLabel(outcome: Outcome): string {
  return outcomeStyles[outcome].label;
}

function citationLabels(ruling: PersistedRulingResponse["ruling"], ids: string[]): string {
  return ids
    .map((id) => {
      const index = ruling.citations.findIndex((citation) => citation.id === id);
      return `[${index + 1}] ${ruling.citations[index]?.label ?? id}`;
    })
    .join(", ");
}

export default function JudgeMessage({
  result,
  onAskAgain,
}: {
  result: PersistedRulingResponse;
  /** Offered on the latest answer: asks the judge the same question again. */
  onAskAgain?: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const [showChallenge, setShowChallenge] = useState(false);
  const { ruling } = result;
  const outcome = outcomeStyles[ruling.outcome];

  return (
    <View style={styles.bubble}>
      <View style={[styles.badge, { backgroundColor: outcome.background }]}>
        <Text style={[styles.badgeText, { color: outcome.color }]}>{outcome.label}</Text>
      </View>
      <Text selectable style={styles.summary}>
        {ruling.summary}
      </Text>
      {ruling.clarificationQuestions.length > 0 ? (
        <View style={styles.clarify}>
          {ruling.clarificationQuestions.map((item) => (
            <Text key={item} style={styles.clarifyText}>
              {item}
            </Text>
          ))}
          <Text style={styles.hint}>Answer below to continue.</Text>
        </View>
      ) : null}

      {showDetails ? (
        <View style={styles.details}>
          {ruling.reasoningSteps.map((step, index) => (
            <View key={`${index}-${step.text}`} style={styles.step}>
              <Text selectable>
                {index + 1}. {step.text}
              </Text>
              {step.citationIds.length > 0 ? (
                <Text style={styles.meta}>{citationLabels(ruling, step.citationIds)}</Text>
              ) : null}
            </View>
          ))}
          {ruling.assumptions.map((item) => (
            <Text key={item} style={styles.meta}>
              Assumes: {item}
            </Text>
          ))}
          {ruling.citations.map((citation, index) => (
            <View key={citation.id} style={styles.citation}>
              <Text style={styles.citationTitle}>
                [{index + 1}] {citation.label}
              </Text>
              <Text selectable style={styles.meta}>
                {citation.excerpt}
              </Text>
              <Pressable
                accessibilityRole="link"
                onPress={() => void Linking.openURL(citation.sourceUrl)}
              >
                <Text style={styles.link}>Source</Text>
              </Pressable>
            </View>
          ))}
          <Text selectable style={styles.meta}>
            Ruling ID {result.rulingId}
          </Text>
          <Text style={styles.meta}>
            Rules snapshot {ruling.snapshot.version}
            {ruling.snapshot.activatedAt
              ? ` · ${new Date(ruling.snapshot.activatedAt).toLocaleDateString()}`
              : ""}
          </Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: showDetails }}
          onPress={() => setShowDetails((current) => !current)}
          style={styles.action}
        >
          <Ionicons
            name={showDetails ? "chevron-up" : "book-outline"}
            size={15}
            color={colors.accent}
          />
          <Text style={styles.actionText}>{showDetails ? "Hide reasoning" : "Reasoning"}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Open the shareable ruling page"
          onPress={() => void Linking.openURL(getPublicRulingUrl(result.rulingId))}
          style={styles.action}
        >
          <Ionicons name="share-outline" size={15} color={colors.accent} />
          <Text style={styles.actionText}>Share</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: showChallenge }}
          onPress={() => setShowChallenge((current) => !current)}
          style={styles.action}
        >
          <Ionicons name="flag-outline" size={15} color={colors.accent} />
          <Text style={styles.actionText}>Challenge</Text>
        </Pressable>
        {onAskAgain ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ask the judge this question again"
            onPress={onAskAgain}
            style={styles.action}
          >
            <Ionicons name="refresh" size={15} color={colors.accent} />
            <Text style={styles.actionText}>Ask again</Text>
          </Pressable>
        ) : null}
      </View>
      {showChallenge ? <ChallengeForm rulingId={result.rulingId} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    alignSelf: "stretch",

    gap: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    borderTopLeftRadius: 4,
    backgroundColor: colors.surface,
  },
  badge: { alignSelf: "flex-start", paddingHorizontal: 9, paddingVertical: 3, borderRadius: 10 },
  badgeText: { fontFamily: fonts.bodySemibold, fontSize: 12, letterSpacing: 0.6 },
  summary: { fontSize: 16, lineHeight: 23 },
  clarify: {
    gap: 6,
    padding: 10,
    borderLeftWidth: 3,
    borderLeftColor: colors.info,
    backgroundColor: colors.infoSurface,
  },
  clarifyText: { color: colors.text, fontWeight: "600" },
  hint: { color: colors.textMuted, fontSize: 12 },
  details: { gap: 10, paddingTop: 4, borderTopWidth: 1, borderTopColor: colors.border },
  step: { gap: 3 },
  meta: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  citation: { gap: 4, padding: 10, borderRadius: 10, backgroundColor: colors.background },
  citationTitle: { color: colors.accent, fontWeight: "700" },
  link: { color: colors.accent, textDecorationLine: "underline", fontSize: 13 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  action: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
  },
  actionText: { color: colors.accent, fontSize: 13, fontWeight: "600" },
});
