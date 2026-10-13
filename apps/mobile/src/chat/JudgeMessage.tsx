import { useState, type ComponentProps } from "react";
import { Pressable, Share, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { PersistedRulingResponse } from "@mtg-rules/contracts";
import ChallengeForm from "../challenges/ChallengeForm";
import { getPublicRulingUrl } from "../rulings/public-ruling-url";
import { isYesNoQuestion, rulesDate, splitVerdict } from "../rulings/verdict-text";
import CitationChip from "../verdict/CitationChip";
import CitationSheet from "../verdict/CitationSheet";
import Text from "../ui/Text";
import { colors, eyebrow, fonts } from "../theme";

type Ruling = PersistedRulingResponse["ruling"];
type Outcome = Ruling["outcome"];

const outcomeStyles: Record<
  Outcome,
  {
    label: string;
    color: string;
    background: string;
    icon: ComponentProps<typeof Ionicons>["name"];
  }
> = {
  resolved: {
    label: "Resolved",
    color: colors.success,
    background: colors.successSurface,
    icon: "checkmark",
  },
  conditional: {
    label: "It depends",
    color: colors.warning,
    background: colors.warningSurface,
    icon: "git-branch-outline",
  },
  needs_information: {
    label: "One more detail",
    color: colors.info,
    background: colors.infoSurface,
    icon: "help",
  },
  uncertain: {
    label: "Not certain",
    color: colors.neutral,
    background: colors.neutralSurface,
    icon: "remove",
  },
};

export function outcomeLabel(outcome: Outcome): string {
  return outcomeStyles[outcome].label;
}

interface JudgeMessageProps {
  result: PersistedRulingResponse;
  /** Offered on the latest answer: asks the judge the same question again. */
  onAskAgain?: () => void;
  /** Offered on the latest answer when the judge asked something: sends a tapped answer. */
  onAnswer?: (answer: string) => void;
  /** Earlier rulings in a chat start with their steps folded away. */
  initiallyExpanded?: boolean;
}

export default function JudgeMessage({
  result,
  onAskAgain,
  onAnswer,
  initiallyExpanded = true,
}: JudgeMessageProps) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [showChallenge, setShowChallenge] = useState(false);
  const [openCitation, setOpenCitation] = useState<string | null>(null);
  const { ruling } = result;
  const outcome = outcomeStyles[ruling.outcome];
  const { headline, body } = splitVerdict(ruling.summary);
  const citationById = new Map(ruling.citations.map((citation) => [citation.id, citation]));
  const asking = ruling.outcome === "needs_information" && ruling.clarificationQuestions.length > 0;
  const rulesOf = rulesDate(ruling.snapshot.version);

  function chips(ids: string[], prominent = false) {
    const cited = ids.flatMap((id) => {
      const citation = citationById.get(id);
      return citation ? [citation] : [];
    });
    if (cited.length === 0) return null;
    return (
      <View style={styles.chips}>
        {cited.map((citation) => (
          <CitationChip
            key={citation.id}
            citation={citation}
            prominent={prominent}
            onPress={() => setOpenCitation(citation.id)}
          />
        ))}
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <View style={[styles.badge, { backgroundColor: outcome.background }]}>
          <Ionicons name={outcome.icon} size={12} color={outcome.color} />
          <Text style={[styles.badgeText, { color: outcome.color }]}>
            {outcome.label.toUpperCase()}
          </Text>
        </View>

        {asking ? (
          <>
            {ruling.clarificationQuestions.map((question) => (
              <Text key={question} selectable style={styles.question}>
                {question}
              </Text>
            ))}
            <Text selectable style={styles.body}>
              {ruling.summary}
            </Text>
          </>
        ) : (
          <>
            {headline ? (
              <Text selectable style={styles.headline}>
                {headline}
              </Text>
            ) : null}
            {body ? (
              <Text selectable style={headline ? styles.body : styles.bodyLarge}>
                {body}
              </Text>
            ) : null}
          </>
        )}
        {chips(ruling.summaryCitationIds, true)}
      </View>

      {asking && onAnswer ? (
        <View style={styles.answers}>
          <Text style={eyebrow}>Tap an answer</Text>
          {ruling.clarificationQuestions.filter(isYesNoQuestion).flatMap((question) =>
            ["Yes", "No"].map((answer) => (
              <Pressable
                key={`${question}-${answer}`}
                accessibilityRole="button"
                accessibilityLabel={`${answer}: ${question}`}
                onPress={() => onAnswer(`${question} ${answer}.`)}
                style={({ pressed }) => [styles.answer, pressed && styles.pressed]}
              >
                <Text numberOfLines={2} style={styles.answerText}>
                  {ruling.clarificationQuestions.length > 1 ? `${answer}: ${question}` : answer}
                </Text>
              </Pressable>
            )),
          )}
          <Text style={styles.hint}>Or answer in your own words below.</Text>
        </View>
      ) : null}

      {ruling.reasoningSteps.length > 0 ? (
        <View style={styles.section}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            onPress={() => setExpanded((current) => !current)}
            style={styles.sectionToggle}
          >
            <Text style={eyebrow}>How it plays out</Text>
            <View style={styles.toggleRight}>
              {!expanded ? (
                <Text style={styles.toggleCount}>
                  {ruling.reasoningSteps.length} step{ruling.reasoningSteps.length === 1 ? "" : "s"}
                </Text>
              ) : null}
              <Ionicons
                name={expanded ? "chevron-up" : "chevron-down"}
                size={16}
                color={colors.textMuted}
              />
            </View>
          </Pressable>
          {expanded
            ? ruling.reasoningSteps.map((step, index) => {
                const last = index === ruling.reasoningSteps.length - 1;
                return (
                  <View key={`${index}-${step.text}`} style={styles.step}>
                    <View style={styles.rail}>
                      <View style={[styles.number, last && styles.numberLast]}>
                        <Text style={[styles.numberText, last && styles.numberTextLast]}>
                          {index + 1}
                        </Text>
                      </View>
                      {!last ? <View style={styles.line} /> : null}
                    </View>
                    <View style={[styles.stepBody, last && styles.stepBodyLast]}>
                      <Text selectable style={styles.stepText}>
                        {step.text}
                      </Text>
                      {chips(step.citationIds)}
                    </View>
                  </View>
                );
              })
            : null}
        </View>
      ) : null}

      {expanded && ruling.assumptions.length > 0 ? (
        <View style={styles.assumptions}>
          <Ionicons name="information-circle-outline" size={18} color={colors.textMuted} />
          <View style={styles.assumptionList}>
            {ruling.assumptions.map((assumption) => (
              <Text key={assumption} style={styles.assumptionText}>
                {/^assum/i.test(assumption)
                  ? assumption
                  : `Assumes ${assumption.charAt(0).toLowerCase()}${assumption.slice(1)}`}
              </Text>
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.actions}>
        <ActionButton
          icon="share-outline"
          label="Share"
          accessibilityLabel="Share a link to this ruling"
          onPress={() => void Share.share({ message: getPublicRulingUrl(result.rulingId) })}
        />
        <ActionButton
          icon="flag-outline"
          label="This looks wrong"
          expanded={showChallenge}
          onPress={() => setShowChallenge((current) => !current)}
        />
      </View>
      {showChallenge ? <ChallengeForm rulingId={result.rulingId} /> : null}

      <View style={styles.footer}>
        <Text style={styles.footnote}>
          {rulesOf
            ? `Checked against the Comprehensive Rules of ${rulesOf} and current Oracle text.`
            : "Checked against the Comprehensive Rules and current Oracle text."}
        </Text>
        {onAskAgain ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ask the judge this question again"
            hitSlop={12}
            onPress={onAskAgain}
          >
            <Text style={styles.askAgain}>Ask again</Text>
          </Pressable>
        ) : null}
      </View>

      <CitationSheet
        ruling={ruling}
        citationId={openCitation}
        onSelect={setOpenCitation}
        onClose={() => setOpenCitation(null)}
      />
    </View>
  );
}

function ActionButton({
  icon,
  label,
  accessibilityLabel,
  expanded,
  onPress,
}: {
  icon: ComponentProps<typeof Ionicons>["name"];
  label: string;
  accessibilityLabel?: string;
  expanded?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={16} color={colors.text} />
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: "stretch", gap: 18 },
  card: {
    gap: 12,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    backgroundColor: colors.surface,
  },
  badge: {
    alignSelf: "flex-start",
    height: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 11,
    borderRadius: 14,
  },
  badgeText: { fontFamily: fonts.bodySemibold, fontSize: 12.5, letterSpacing: 0.4 },
  headline: { fontFamily: fonts.display, fontSize: 28, lineHeight: 33 },
  question: { fontFamily: fonts.display, fontSize: 23, lineHeight: 29 },
  body: { color: colors.textSoft, fontSize: 15.5, lineHeight: 23 },
  bodyLarge: { fontSize: 17, lineHeight: 25 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  answers: { gap: 8 },
  answer: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 14,
    backgroundColor: colors.accentSurface,
  },
  answerText: { color: colors.accentText, fontSize: 15 },
  hint: { color: colors.textMuted, fontSize: 12.5 },
  section: { gap: 4 },
  sectionToggle: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  toggleRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  toggleCount: { color: colors.textMuted, fontSize: 12.5 },
  step: { flexDirection: "row", gap: 14 },
  rail: { alignItems: "center" },
  number: {
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: colors.accent,
    borderRadius: 13,
  },
  numberLast: { backgroundColor: colors.accent },
  numberText: { color: colors.accent, fontFamily: fonts.bodySemibold, fontSize: 12.5 },
  numberTextLast: { color: colors.accentInk },
  line: { flex: 1, width: 1.5, minHeight: 16, backgroundColor: colors.border },
  stepBody: { flex: 1, gap: 8, paddingTop: 2, paddingBottom: 18 },
  stepBodyLast: { paddingBottom: 4 },
  stepText: { fontSize: 15, lineHeight: 22 },
  assumptions: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.surfaceSunken,
  },
  assumptionList: { flex: 1, gap: 6 },
  assumptionText: { color: colors.textSoft, fontSize: 13.5, lineHeight: 20 },
  actions: { flexDirection: "row", gap: 10 },
  action: {
    flex: 1,
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
  },
  actionText: { fontSize: 14 },
  pressed: { opacity: 0.7 },
  footer: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  footnote: { flex: 1, color: colors.textSubtle, fontSize: 12, lineHeight: 18 },
  askAgain: { color: colors.accent, fontSize: 13 },
});
