import { useState, type ComponentProps } from "react";
import { Pressable, Share, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { PersistedRulingResponse } from "@mtg-rules/contracts";
import { getPublicRulingUrl } from "../rulings/public-ruling-url";
import { isYesNoQuestion, rulesDate, splitVerdict } from "../rulings/verdict-text";
import CitationChip from "../verdict/CitationChip";
import CitationSheet from "../verdict/CitationSheet";
import Text from "../ui/Text";
import { colors, eyebrow, fonts } from "../theme";
import { useT } from "../i18n/LanguageProvider";

type Ruling = PersistedRulingResponse["ruling"];
type Outcome = Ruling["outcome"];

const outcomeStyles: Record<
  Outcome,
  {
    color: string;
    background: string;
    icon: ComponentProps<typeof Ionicons>["name"];
  }
> = {
  resolved: {
    color: colors.success,
    background: colors.successSurface,
    icon: "checkmark",
  },
  conditional: {
    color: colors.warning,
    background: colors.warningSurface,
    icon: "git-branch-outline",
  },
  needs_information: {
    color: colors.info,
    background: colors.infoSurface,
    icon: "help",
  },
  uncertain: {
    color: colors.neutral,
    background: colors.neutralSurface,
    icon: "remove",
  },
};

interface JudgeMessageProps {
  result: PersistedRulingResponse;
  /** Offered on the latest answer: asks the judge the same question again. */
  onAskAgain?: () => void;
  /** Offered on the latest answer when the judge asked something: sends a tapped answer. */
  onAnswer?: (answer: string) => void;
  /** Earlier rulings in a chat start with their steps folded away. */
  initiallyExpanded?: boolean;
  /** Opens the dispute screen; left out where a ruling cannot be disputed (old versions). */
  onDispute?: () => void;
}

export default function JudgeMessage({
  result,
  onAskAgain,
  onAnswer,
  initiallyExpanded = true,
  onDispute,
}: JudgeMessageProps) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const { t, locale } = useT();
  const [openCitation, setOpenCitation] = useState<string | null>(null);
  const { ruling } = result;
  const outcome = outcomeStyles[ruling.outcome];
  const { headline, body } = splitVerdict(ruling.summary);
  const citationById = new Map(ruling.citations.map((citation) => [citation.id, citation]));
  const questions = ruling.clarificationQuestions;
  // When the judge needs a detail before ruling, the question leads; otherwise the answer does.
  const asking = ruling.outcome === "needs_information" && questions.length > 0;
  const yesNoQuestions = questions.filter(isYesNoQuestion);
  const rulesOf = rulesDate(ruling.snapshot.version, locale);
  // Without steps there is nothing to fold, so the rest always shows.
  const showDetails = expanded || ruling.reasoningSteps.length === 0;
  const chipped = new Set([
    ...ruling.summaryCitationIds,
    ...ruling.reasoningSteps.flatMap((step) => step.citationIds),
  ]);
  const unchipped = ruling.citations.filter((citation) => !chipped.has(citation.id));

  function chips(ids: string[], prominent = false) {
    const cited = [...new Set(ids)].flatMap((id) => {
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
            {t.verdict.outcomes[ruling.outcome].toLocaleUpperCase(locale)}
          </Text>
        </View>

        {asking ? (
          <>
            {ruling.clarificationQuestions.map((question, index) => (
              <Text key={`${index}-${question}`} selectable style={styles.question}>
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
        {!asking && questions.length > 0 ? (
          <View style={styles.openQuestions}>
            <Text style={[eyebrow, styles.openQuestionsLabel]}>{t.verdict.openQuestions}</Text>
            {questions.map((question, index) => (
              <Text key={`${index}-${question}`} selectable style={styles.openQuestion}>
                {question}
              </Text>
            ))}
          </View>
        ) : null}
      </View>

      {onAnswer && yesNoQuestions.length > 0 ? (
        <View style={styles.answers}>
          <Text style={eyebrow}>{t.verdict.tapAnswer}</Text>
          {yesNoQuestions.flatMap((question) =>
            [t.common.yes, t.common.no].map((answer) => (
              <Pressable
                key={`${question}-${answer}`}
                accessibilityRole="button"
                accessibilityLabel={`${answer}: ${question}`}
                onPress={() => onAnswer(`${question} ${answer}.`)}
                style={({ pressed }) => [styles.answer, pressed && styles.pressed]}
              >
                <Text numberOfLines={2} style={styles.answerText}>
                  {questions.length > 1 ? `${answer}: ${question}` : answer}
                </Text>
              </Pressable>
            )),
          )}
          <Text style={styles.hint}>{t.verdict.ownWords}</Text>
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
            <Text style={eyebrow}>{t.verdict.howItPlaysOut}</Text>
            <View style={styles.toggleRight}>
              {!expanded ? (
                <Text style={styles.toggleCount}>
                  {t.verdict.steps(ruling.reasoningSteps.length)}
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

      {showDetails && unchipped.length > 0 ? (
        <View style={styles.section}>
          <Text style={eyebrow}>{t.verdict.alsoRead}</Text>
          {chips(unchipped.map((citation) => citation.id))}
        </View>
      ) : null}

      {showDetails && ruling.assumptions.length > 0 ? (
        <View style={styles.assumptions}>
          <Ionicons name="information-circle-outline" size={18} color={colors.textMuted} />
          <View style={styles.assumptionList}>
            {ruling.assumptions.map((assumption, index) => (
              <Text key={`${index}-${assumption}`} style={styles.assumptionText}>
                {t.verdict.assumes(assumption)}
              </Text>
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.actions}>
        <ActionButton
          icon="share-outline"
          label={t.verdict.share}
          accessibilityLabel={t.verdict.shareLabel}
          onPress={() => void Share.share({ message: getPublicRulingUrl(result.rulingId) })}
        />
        {onDispute ? (
          <ActionButton icon="flag-outline" label={t.verdict.looksWrong} onPress={onDispute} />
        ) : null}
      </View>

      <View style={styles.footer}>
        <Text selectable style={styles.footnote}>
          {rulesOf ? t.verdict.checked(rulesOf) : t.verdict.checkedNoDate}
          {`\n${t.verdict.snapshot(ruling.snapshot.version)}`}
        </Text>
        {onAskAgain ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.verdict.askAgainLabel}
            onPress={onAskAgain}
            style={styles.askAgainButton}
          >
            <Text style={styles.askAgain}>{t.verdict.askAgain}</Text>
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
  onPress,
}: {
  icon: ComponentProps<typeof Ionicons>["name"];
  label: string;
  accessibilityLabel?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
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
  askAgainButton: { minHeight: 44, minWidth: 64, alignItems: "flex-end", marginTop: -12 },
  askAgain: { color: colors.accent, fontSize: 13, lineHeight: 44 },
  openQuestions: {
    gap: 6,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  openQuestionsLabel: { color: colors.info },
  openQuestion: { fontSize: 15, lineHeight: 22 },
});
