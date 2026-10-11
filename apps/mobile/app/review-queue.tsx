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
import { reviewQueueResponseSchema, type ReviewQueueResponse } from "@mtg-rules/contracts";
import { useAuth } from "../src/auth/AuthProvider";
import { apiUrl } from "../src/api-url";

export default function ReviewQueueScreen() {
  const { session, loading: authLoading } = useAuth();
  const [queue, setQueue] = useState<ReviewQueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [reasons, setReasons] = useState<Record<string, string>>({});

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
