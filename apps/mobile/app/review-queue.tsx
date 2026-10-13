import { colors, fonts } from "../src/theme";
import { useCallback, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import TextInput from "../src/ui/TextInput";
import Text from "../src/ui/Text";
import {
  reviewDecisionRequestSchema,
  reviewQueueResponseSchema,
  type ReviewDecisionRequest,
  type ReviewQueueResponse,
} from "@mtg-rules/contracts";
import { adminAccessMessage, readAdminAccessDenial } from "../src/auth/admin-access";
import { useAuth } from "../src/auth/AuthProvider";
import { apiUrl } from "../src/api-url";
import { useT } from "../src/i18n/LanguageProvider";
import { strings } from "../src/i18n/core";

export default function ReviewQueueScreen() {
  const { session, loading: authLoading } = useAuth();
  const { t, locale } = useT();
  const [queue, setQueue] = useState<ReviewQueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [needsVerification, setNeedsVerification] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [decisionReasons, setDecisionReasons] = useState<Record<string, string>>({});
  const [corrections, setCorrections] = useState<
    Record<
      string,
      {
        outcome: "resolved" | "conditional" | "needs_information" | "uncertain";
        errorCategory:
          | "card_resolution"
          | "missing_game_fact"
          | "retrieval"
          | "reasoning"
          | "outdated_source"
          | "presentation";
        includeInEvaluation: boolean;
        evaluationFixtureJson: string;
        summary: string;
        reasoning: string;
      }
    >
  >({});

  const loadQueue = useCallback(async () => {
    if (!session) {
      setQueue(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setQueue(null);
    setMessage("");
    setNeedsVerification(false);
    try {
      const response = await fetch(`${apiUrl}/api/admin/challenges`, {
        headers: { authorization: `Bearer ${session.access_token}` },
      });
      const denial = await readAdminAccessDenial(response);
      if (denial) {
        setNeedsVerification(denial !== "not_admin");
        throw new Error(adminAccessMessage(denial));
      }
      if (!response.ok) throw new Error(strings().review.unavailable);
      setQueue(reviewQueueResponseSchema.parse(await response.json()));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : strings().review.unavailable);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useFocusEffect(
    useCallback(() => {
      if (!authLoading) void loadQueue();
    }, [authLoading, loadQueue]),
  );

  async function requestInformation(challengeId: string) {
    if (!session) return;
    const reason = reasons[challengeId]?.trim() ?? "";
    if (reason.length < 10) {
      setMessage(t.review.reasonTooShort);
      return;
    }
    try {
      const response = await fetch(
        `${apiUrl}/api/admin/challenges/${encodeURIComponent(challengeId)}/request-information`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${session.access_token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ reason }),
        },
      );
      const denial = await readAdminAccessDenial(response);
      if (denial) {
        setNeedsVerification(denial !== "not_admin");
        throw new Error(adminAccessMessage(denial));
      }
      if (response.status === 409) throw new Error(t.review.changed);
      if (!response.ok) throw new Error(t.review.requestFailed);
      setReasons((current) => ({ ...current, [challengeId]: "" }));
      setMessage(t.review.requested);
      await loadQueue();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t.review.requestFailed);
    }
  }

  async function decide(challengeId: string, decision: "approve" | "reject") {
    if (!session) return;
    const reason = decisionReasons[challengeId]?.trim() ?? "";
    const correction = corrections[challengeId] ?? {
      outcome: "resolved" as const,
      errorCategory: "reasoning" as const,
      includeInEvaluation: false,
      evaluationFixtureJson: "",
      summary: "",
      reasoning: "",
    };
    let payload: ReviewDecisionRequest;
    let evaluationFixture: unknown;
    try {
      if (correction.includeInEvaluation) {
        evaluationFixture = JSON.parse(correction.evaluationFixtureJson) as unknown;
      }
      payload = reviewDecisionRequestSchema.parse(
        decision === "approve"
          ? {
              decision,
              reason,
              correction: {
                errorCategory: correction.errorCategory,
                includeInEvaluation: correction.includeInEvaluation,
                ...(correction.includeInEvaluation ? { evaluationFixture } : {}),
                outcome: correction.outcome,
                summary: correction.summary,
                reasoningSteps: [correction.reasoning],
                assumptions: [],
              },
            }
          : { decision, reason },
      );
    } catch {
      setMessage(decision === "approve" ? t.review.invalidApproval : t.review.invalidRejection);
      return;
    }
    try {
      const response = await fetch(
        `${apiUrl}/api/admin/challenges/${encodeURIComponent(challengeId)}/decision`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${session.access_token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );
      const denial = await readAdminAccessDenial(response);
      if (denial) {
        setNeedsVerification(denial !== "not_admin");
        throw new Error(adminAccessMessage(denial));
      }
      if (response.status === 409) throw new Error(t.review.alreadyDecided);
      if (response.status === 400) throw new Error(t.review.badCorrection);
      if (!response.ok) throw new Error(t.review.decisionFailed);
      setMessage(decision === "approve" ? t.review.approved : t.review.rejected);
      await loadQueue();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t.review.decisionFailed);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text accessibilityRole="header" style={styles.title}>
          {t.review.title}
        </Text>
        {authLoading || loading ? (
          <ActivityIndicator accessibilityLabel={t.review.loading} />
        ) : null}
        {!session && !authLoading ? (
          <Text style={styles.message}>{t.review.signInAdmin}</Text>
        ) : null}
        {message ? (
          <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.message}>
            {message}
          </Text>
        ) : null}
        {needsVerification ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/admin-verify")}
            style={styles.button}
          >
            <Text style={styles.buttonText}>{t.review.verify}</Text>
          </Pressable>
        ) : null}
        {queue?.challenges.length === 0 ? <Text>{t.review.empty}</Text> : null}
        {queue?.challenges.map((item) => (
          <View key={item.challengeId} style={styles.card}>
            <Text style={styles.status}>{t.review.statuses[item.challenge.status]}</Text>
            <Text style={styles.meta}>{t.review.consent(item.evaluationConsent)}</Text>
            <Text style={styles.sectionTitle}>{t.review.question}</Text>
            <Text style={styles.body}>{item.question}</Text>
            <Text style={styles.sectionTitle}>
              {t.review.originalAnswer(t.review.outcomes[item.originalRuling.outcome])}
            </Text>
            <Text style={styles.body}>{item.originalRuling.summary}</Text>
            {item.originalRuling.reasoningSteps.map((step, index) => (
              <Text key={`${index}-${step.text}`} style={styles.body}>
                {index + 1}. {step.text}
              </Text>
            ))}
            {item.originalRuling.assumptions.map((assumption, index) => (
              <Text key={`${index}-${assumption}`} style={styles.meta}>
                {t.review.assumption(assumption)}
              </Text>
            ))}
            <Text style={styles.sectionTitle}>{t.review.gameFacts}</Text>
            {[...item.originalRuling.gameState.events, ...item.originalRuling.gameState.knownFacts]
              .length === 0 ? (
              <Text style={styles.meta}>{t.review.noFacts}</Text>
            ) : (
              [
                ...item.originalRuling.gameState.events,
                ...item.originalRuling.gameState.knownFacts,
              ].map((fact, index) => (
                <Text key={`${index}-${fact}`} style={styles.body}>
                  • {fact}
                </Text>
              ))
            )}
            {item.originalRuling.gameState.missingFacts.map((fact, index) => (
              <Text key={`${index}-${fact}`} style={styles.meta}>
                {t.review.missingFact(fact)}
              </Text>
            ))}
            {item.originalRuling.confirmedCards.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>{t.review.confirmedCards}</Text>
                {item.originalRuling.confirmedCards.map((card) => (
                  <View
                    key={`${card.oracleId}-${card.faceIndex ?? "card"}`}
                    style={styles.citation}
                  >
                    <Text style={styles.sectionTitle}>
                      {card.faceName ?? card.cardName}
                      {card.quantity > 1 ? ` ×${card.quantity}` : ""}
                    </Text>
                    {card.oracleText ? <Text style={styles.body}>{card.oracleText}</Text> : null}
                  </View>
                ))}
              </View>
            ) : null}
            <Text style={styles.meta}>
              {t.review.snapshot(
                item.originalRuling.snapshot.version,
                item.originalRuling.snapshot.activatedAt
                  ? new Date(item.originalRuling.snapshot.activatedAt).toLocaleDateString(locale)
                  : t.review.noActivation,
              )}
            </Text>
            {item.originalRuling.citations.map((citation, index) => (
              <View key={`${index}-${citation.sourceUrl}`} style={styles.citation}>
                <Text style={styles.sectionTitle}>{citation.label}</Text>
                <Text style={styles.body}>{citation.excerpt}</Text>
                <Text style={styles.meta}>{citation.sourceUrl}</Text>
              </View>
            ))}
            <Text style={styles.sectionTitle}>{t.review.challenge}</Text>
            <Text style={styles.body}>{item.challenge.explanation}</Text>
            {item.challenge.proposedOutcome ? (
              <Text style={styles.meta}>
                {t.review.proposedOutcome(t.review.outcomes[item.challenge.proposedOutcome])}
              </Text>
            ) : null}
            {item.challenge.latestInformationRequest ? (
              <Text style={styles.meta}>
                {t.review.previousRequest(item.challenge.latestInformationRequest.reason)}
              </Text>
            ) : null}
            <TextInput
              placeholderTextColor={colors.textSubtle}
              accessibilityLabel={t.review.infoLabel(item.challengeId)}
              multiline
              maxLength={2_000}
              value={reasons[item.challengeId] ?? ""}
              onChangeText={(value) =>
                setReasons((current) => ({ ...current, [item.challengeId]: value }))
              }
              placeholder={t.review.infoPlaceholder}
              style={styles.input}
            />
            <Pressable
              accessibilityRole="button"
              onPress={() => void requestInformation(item.challengeId)}
              style={styles.button}
            >
              <Text style={styles.buttonText}>{t.review.requestInfo}</Text>
            </Pressable>
            <Text style={styles.sectionTitle}>{t.review.recordDecision}</Text>
            <TextInput
              placeholderTextColor={colors.textSubtle}
              accessibilityLabel={t.review.decisionLabel(item.challengeId)}
              multiline
              maxLength={2_000}
              value={decisionReasons[item.challengeId] ?? ""}
              onChangeText={(value) =>
                setDecisionReasons((current) => ({ ...current, [item.challengeId]: value }))
              }
              placeholder={t.review.decisionPlaceholder}
              style={styles.input}
            />
            <Text style={styles.meta}>{t.review.forApproval}</Text>
            <Text style={styles.sectionTitle}>{t.review.errorCategory}</Text>
            <View style={styles.choices}>
              {(
                [
                  "card_resolution",
                  "missing_game_fact",
                  "retrieval",
                  "reasoning",
                  "outdated_source",
                  "presentation",
                ] as const
              ).map((errorCategory) => (
                <Pressable
                  key={errorCategory}
                  accessibilityRole="button"
                  accessibilityState={{
                    selected:
                      (corrections[item.challengeId]?.errorCategory ?? "reasoning") ===
                      errorCategory,
                  }}
                  onPress={() =>
                    setCorrections((current) => ({
                      ...current,
                      [item.challengeId]: {
                        ...(current[item.challengeId] ?? {
                          outcome: "resolved",
                          errorCategory: "reasoning",
                          includeInEvaluation: false,
                          evaluationFixtureJson: "",
                          summary: "",
                          reasoning: "",
                        }),
                        errorCategory,
                      },
                    }))
                  }
                  style={[
                    styles.choice,
                    (corrections[item.challengeId]?.errorCategory ?? "reasoning") ===
                      errorCategory && styles.selectedChoice,
                  ]}
                >
                  <Text style={styles.choiceText}>{t.review.categories[errorCategory]}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{
                checked: corrections[item.challengeId]?.includeInEvaluation ?? false,
                disabled: !item.evaluationConsent,
              }}
              disabled={!item.evaluationConsent}
              onPress={() =>
                setCorrections((current) => {
                  const previous = current[item.challengeId] ?? {
                    outcome: "resolved" as const,
                    errorCategory: "reasoning" as const,
                    includeInEvaluation: false,
                    evaluationFixtureJson: "",
                    summary: "",
                    reasoning: "",
                  };
                  const includeInEvaluation = !previous.includeInEvaluation;
                  return {
                    ...current,
                    [item.challengeId]: {
                      ...previous,
                      includeInEvaluation,
                      evaluationFixtureJson: includeInEvaluation
                        ? previous.evaluationFixtureJson
                        : "",
                    },
                  };
                })
              }
              style={styles.evalToggle}
            >
              <Text style={styles.body}>
                {corrections[item.challengeId]?.includeInEvaluation ? "☑" : "☐"}{" "}
                {t.review.addToEvaluation}
              </Text>
            </Pressable>
            {corrections[item.challengeId]?.includeInEvaluation ? (
              <>
                <Text style={styles.meta}>{t.review.fixtureHelp}</Text>
                <TextInput
                  placeholderTextColor={colors.textSubtle}
                  accessibilityLabel={t.review.fixtureLabel(item.challengeId)}
                  multiline
                  maxLength={20_000}
                  value={corrections[item.challengeId]?.evaluationFixtureJson ?? ""}
                  onChangeText={(evaluationFixtureJson) =>
                    setCorrections((current) => ({
                      ...current,
                      [item.challengeId]: {
                        ...(current[item.challengeId] ?? {
                          outcome: "resolved",
                          errorCategory: "reasoning",
                          includeInEvaluation: true,
                          evaluationFixtureJson: "",
                          summary: "",
                          reasoning: "",
                        }),
                        evaluationFixtureJson,
                      },
                    }))
                  }
                  placeholder={
                    '{"question":"...","cards":[],"rules":[],"expectedOutcome":"uncertain","expectedRuleNumbers":[],"expectedClarificationCount":0,"modelOutput":{"outcome":"uncertain","summary":"...","summarySupport":"UNSUPPORTED","summaryCitationNumbers":[],"reasoningSteps":[],"assumptions":[],"clarificationQuestions":[]}}'
                  }
                  style={styles.input}
                />
              </>
            ) : null}
            <View style={styles.choices}>
              {(["resolved", "conditional", "needs_information", "uncertain"] as const).map(
                (outcome) => (
                  <Pressable
                    key={outcome}
                    accessibilityRole="button"
                    accessibilityState={{
                      selected: (corrections[item.challengeId]?.outcome ?? "resolved") === outcome,
                    }}
                    onPress={() =>
                      setCorrections((current) => ({
                        ...current,
                        [item.challengeId]: {
                          ...(current[item.challengeId] ?? {
                            outcome: "resolved",
                            errorCategory: "reasoning",
                            includeInEvaluation: false,
                            evaluationFixtureJson: "",
                            summary: "",
                            reasoning: "",
                          }),
                          outcome,
                        },
                      }))
                    }
                    style={[
                      styles.choice,
                      (corrections[item.challengeId]?.outcome ?? "resolved") === outcome &&
                        styles.selectedChoice,
                    ]}
                  >
                    <Text style={styles.choiceText}>{t.review.outcomes[outcome]}</Text>
                  </Pressable>
                ),
              )}
            </View>
            <TextInput
              placeholderTextColor={colors.textSubtle}
              accessibilityLabel={t.review.summaryLabel(item.challengeId)}
              multiline
              maxLength={1_200}
              value={corrections[item.challengeId]?.summary ?? ""}
              onChangeText={(summary) =>
                setCorrections((current) => ({
                  ...current,
                  [item.challengeId]: {
                    ...(current[item.challengeId] ?? {
                      outcome: "resolved",
                      errorCategory: "reasoning",
                      includeInEvaluation: false,
                      evaluationFixtureJson: "",
                      summary: "",
                      reasoning: "",
                    }),
                    summary,
                  },
                }))
              }
              placeholder={t.review.summaryPlaceholder}
              style={styles.input}
            />
            <TextInput
              placeholderTextColor={colors.textSubtle}
              accessibilityLabel={t.review.reasoningLabel(item.challengeId)}
              multiline
              maxLength={800}
              value={corrections[item.challengeId]?.reasoning ?? ""}
              onChangeText={(reasoning) =>
                setCorrections((current) => ({
                  ...current,
                  [item.challengeId]: {
                    ...(current[item.challengeId] ?? {
                      outcome: "resolved",
                      errorCategory: "reasoning",
                      includeInEvaluation: false,
                      evaluationFixtureJson: "",
                      summary: "",
                      reasoning: "",
                    }),
                    reasoning,
                  },
                }))
              }
              placeholder={t.review.reasoningPlaceholder}
              style={styles.input}
            />
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => void decide(item.challengeId, "approve")}
                style={styles.button}
              >
                <Text style={styles.buttonText}>{t.review.approve}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => void decide(item.challengeId, "reject")}
                style={styles.rejectButton}
              >
                <Text style={styles.rejectButtonText}>{t.review.reject}</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  container: { width: "100%", maxWidth: 800, alignSelf: "center", padding: 18, gap: 14 },
  title: { color: colors.accent, fontFamily: fonts.bodySemibold, fontSize: 28 },
  card: { gap: 10, padding: 16, borderRadius: 14, backgroundColor: colors.surface },
  status: {
    color: colors.accent,
    fontSize: 13,
    fontFamily: fonts.bodySemibold,
    textTransform: "uppercase",
  },
  sectionTitle: { color: colors.accent, fontFamily: fonts.bodySemibold, fontSize: 16 },
  body: { color: colors.text, fontSize: 15, lineHeight: 22 },
  meta: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  citation: { gap: 5, padding: 10, borderRadius: 8, backgroundColor: colors.background },
  section: { gap: 8, paddingTop: 8 },
  evalToggle: { minHeight: 44, justifyContent: "center" },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  choice: {
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  selectedChoice: { borderColor: colors.accent, backgroundColor: colors.successSurface },
  choiceText: { color: colors.text, fontSize: 12, textTransform: "capitalize" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  rejectButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    borderRadius: 9,
    backgroundColor: "#8b3028",
  },
  input: {
    color: colors.text,
    minHeight: 82,
    padding: 10,
    textAlignVertical: "top",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
  },
  button: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    borderRadius: 9,
    backgroundColor: colors.accent,
  },
  buttonText: { color: colors.accentInk, fontSize: 14, fontFamily: fonts.bodySemibold },
  rejectButtonText: { color: colors.text, fontSize: 14, fontFamily: fonts.bodySemibold },
  message: { color: colors.warning, fontFamily: fonts.bodySemibold },
});
