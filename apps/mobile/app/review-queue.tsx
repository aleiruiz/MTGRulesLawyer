import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  reviewDecisionRequestSchema,
  reviewQueueResponseSchema,
  type ReviewDecisionRequest,
  type ReviewQueueResponse,
} from "@mtg-rules/contracts";
import { useAuth } from "../src/auth/AuthProvider";
import { apiUrl } from "../src/api-url";

export default function ReviewQueueScreen() {
  const { session, loading: authLoading } = useAuth();
  const [queue, setQueue] = useState<ReviewQueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
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
    try {
      const response = await fetch(`${apiUrl}/api/admin/challenges`, {
        headers: { authorization: `Bearer ${session.access_token}` },
      });
      if (response.status === 403)
        throw new Error("Admin access is required to review challenges.");
      if (!response.ok) throw new Error("The review queue is temporarily unavailable.");
      setQueue(reviewQueueResponseSchema.parse(await response.json()));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The review queue is unavailable.");
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
      setMessage("Enter at least 10 characters explaining what information is needed.");
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
      if (response.status === 403)
        throw new Error("Admin access is required to review challenges.");
      if (response.status === 409)
        throw new Error("This challenge changed while you were reviewing it. Refresh the queue.");
      if (!response.ok) throw new Error("The information request could not be saved.");
      setReasons((current) => ({ ...current, [challengeId]: "" }));
      setMessage("Information requested. The challenge remains in the review queue.");
      await loadQueue();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The request could not be saved.");
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
      setMessage(
        decision === "approve"
          ? "Provide a valid corrected answer. For evaluation, include a complete valid JSON fixture and confirm the player opted in."
          : "Provide at least 10 characters explaining the rejection.",
      );
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
      if (response.status === 403)
        throw new Error("Admin access is required to review challenges.");
      if (response.status === 409)
        throw new Error("This challenge was already decided. Refresh the queue.");
      if (response.status === 400)
        throw new Error(
          "Review the corrected answer and sanitized scenario. Evaluation use needs the player's consent.",
        );
      if (!response.ok) throw new Error("The decision could not be saved.");
      setMessage(
        decision === "approve" ? "Correction approved and saved." : "Challenge rejected and saved.",
      );
      await loadQueue();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The decision could not be saved.");
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text accessibilityRole="header" style={styles.title}>
          Challenge review queue
        </Text>
        {authLoading || loading ? (
          <ActivityIndicator accessibilityLabel="Loading review queue" />
        ) : null}
        {!session && !authLoading ? (
          <Text style={styles.message}>Sign in with an admin account to review challenges.</Text>
        ) : null}
        {message ? (
          <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.message}>
            {message}
          </Text>
        ) : null}
        {queue?.challenges.length === 0 ? <Text>No challenges are waiting for review.</Text> : null}
        {queue?.challenges.map((item) => (
          <View key={item.challengeId} style={styles.card}>
            <Text style={styles.status}>{item.challenge.status.replaceAll("_", " ")}</Text>
            <Text style={styles.meta}>
              Evaluation consent: {item.evaluationConsent ? "granted" : "not granted"}
            </Text>
            <Text style={styles.sectionTitle}>Question</Text>
            <Text style={styles.body}>{item.question}</Text>
            <Text style={styles.sectionTitle}>
              Original answer · {item.originalRuling.outcome.replaceAll("_", " ")}
            </Text>
            <Text style={styles.body}>{item.originalRuling.summary}</Text>
            {item.originalRuling.reasoningSteps.map((step, index) => (
              <Text key={`${index}-${step.text}`} style={styles.body}>
                {index + 1}. {step.text}
              </Text>
            ))}
            {item.originalRuling.assumptions.map((assumption, index) => (
              <Text key={`${index}-${assumption}`} style={styles.meta}>
                Assumption: {assumption}
              </Text>
            ))}
            <Text style={styles.sectionTitle}>Game facts</Text>
            {[...item.originalRuling.gameState.events, ...item.originalRuling.gameState.knownFacts]
              .length === 0 ? (
              <Text style={styles.meta}>No additional game facts were recorded.</Text>
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
                Missing fact: {fact}
              </Text>
            ))}
            {item.originalRuling.confirmedCards.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Confirmed cards</Text>
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
              Rules snapshot {item.originalRuling.snapshot.version} ·{" "}
              {item.originalRuling.snapshot.activatedAt
                ? new Date(item.originalRuling.snapshot.activatedAt).toLocaleDateString()
                : "activation date unavailable"}
            </Text>
            {item.originalRuling.citations.map((citation, index) => (
              <View key={`${index}-${citation.sourceUrl}`} style={styles.citation}>
                <Text style={styles.sectionTitle}>{citation.label}</Text>
                <Text style={styles.body}>{citation.excerpt}</Text>
                <Text style={styles.meta}>{citation.sourceUrl}</Text>
              </View>
            ))}
            <Text style={styles.sectionTitle}>Challenge</Text>
            <Text style={styles.body}>{item.challenge.explanation}</Text>
            {item.challenge.proposedOutcome ? (
              <Text style={styles.meta}>
                Proposed outcome: {item.challenge.proposedOutcome.replaceAll("_", " ")}
              </Text>
            ) : null}
            {item.challenge.latestInformationRequest ? (
              <Text style={styles.meta}>
                Previous request: {item.challenge.latestInformationRequest.reason}
              </Text>
            ) : null}
            <TextInput
              accessibilityLabel={`Information needed for challenge ${item.challengeId}`}
              multiline
              maxLength={2_000}
              value={reasons[item.challengeId] ?? ""}
              onChangeText={(value) =>
                setReasons((current) => ({ ...current, [item.challengeId]: value }))
              }
              placeholder="Explain what additional information the player should provide."
              style={styles.input}
            />
            <Pressable
              accessibilityRole="button"
              onPress={() => void requestInformation(item.challengeId)}
              style={styles.button}
            >
              <Text style={styles.buttonText}>Request more information</Text>
            </Pressable>
            <Text style={styles.sectionTitle}>Record a decision</Text>
            <TextInput
              accessibilityLabel={`Decision reason for challenge ${item.challengeId}`}
              multiline
              maxLength={2_000}
              value={decisionReasons[item.challengeId] ?? ""}
              onChangeText={(value) =>
                setDecisionReasons((current) => ({ ...current, [item.challengeId]: value }))
              }
              placeholder="Required reason for approval or rejection."
              style={styles.input}
            />
            <Text style={styles.meta}>For approval, write the corrected answer:</Text>
            <Text style={styles.sectionTitle}>Error category</Text>
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
                  <Text style={styles.choiceText}>{errorCategory.replaceAll("_", " ")}</Text>
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
                {corrections[item.challengeId]?.includeInEvaluation ? "☑" : "☐"} Add a sanitized
                scenario to regression evaluation
              </Text>
            </Pressable>
            {corrections[item.challengeId]?.includeInEvaluation ? (
              <>
                <Text style={styles.meta}>
                  Write the complete fixture for the rewritten scenario. Include only cards, rules,
                  expected answer text, and citations you reviewed for accuracy and privacy. The
                  exporter uses this fixture as a unit and does not copy content from the challenge.
                </Text>
                <TextInput
                  accessibilityLabel={`Complete reviewed evaluation fixture JSON for challenge ${item.challengeId}`}
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
                    <Text style={styles.choiceText}>{outcome.replaceAll("_", " ")}</Text>
                  </Pressable>
                ),
              )}
            </View>
            <TextInput
              accessibilityLabel={`Corrected ruling summary for challenge ${item.challengeId}`}
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
              placeholder="Corrected answer summary."
              style={styles.input}
            />
            <TextInput
              accessibilityLabel={`Corrected ruling reasoning for challenge ${item.challengeId}`}
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
              placeholder="Explain the corrected result."
              style={styles.input}
            />
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => void decide(item.challengeId, "approve")}
                style={styles.button}
              >
                <Text style={styles.buttonText}>Approve correction</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => void decide(item.challengeId, "reject")}
                style={styles.rejectButton}
              >
                <Text style={styles.buttonText}>Reject challenge</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#f4f1e8" },
  container: { width: "100%", maxWidth: 800, alignSelf: "center", padding: 18, gap: 14 },
  title: { color: "#17212b", fontSize: 28, fontWeight: "800" },
  card: { gap: 10, padding: 16, borderRadius: 14, backgroundColor: "#fff" },
  status: { color: "#145da0", fontSize: 13, fontWeight: "800", textTransform: "uppercase" },
  sectionTitle: { color: "#17212b", fontSize: 16, fontWeight: "700" },
  body: { color: "#303b45", fontSize: 15, lineHeight: 22 },
  meta: { color: "#5b5a55", fontSize: 12, lineHeight: 18 },
  citation: { gap: 5, padding: 10, borderRadius: 8, backgroundColor: "#f7f6f2" },
  section: { gap: 8, paddingTop: 8 },
  evalToggle: { minHeight: 44, justifyContent: "center" },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  choice: {
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: "#a5b4ab",
    borderRadius: 8,
    backgroundColor: "#fff",
  },
  selectedChoice: { borderColor: "#1f5d50", backgroundColor: "#e1efe7" },
  choiceText: { color: "#18312f", fontSize: 12, textTransform: "capitalize" },
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
    minHeight: 82,
    padding: 10,
    textAlignVertical: "top",
    borderWidth: 1,
    borderColor: "#9caaa2",
    borderRadius: 8,
  },
  button: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    borderRadius: 9,
    backgroundColor: "#1f5d50",
  },
  buttonText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  message: { color: "#804700", fontWeight: "600" },
});
