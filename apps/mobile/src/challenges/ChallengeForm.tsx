import { useState } from "react";
import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import {
  challengeResponseSchema,
  challengeSubmissionRequestSchema,
  type RulingGenerationResponse,
} from "@mtg-rules/contracts";
import { useAuth } from "../auth/AuthProvider";
import { apiUrl } from "../api-url";

const proposedOutcomes: Array<RulingGenerationResponse["outcome"] | undefined> = [
  undefined,
  "resolved",
  "conditional",
  "needs_information",
  "uncertain",
];

export default function ChallengeForm({ rulingId }: { rulingId: string }) {
  const { session } = useAuth();
  const [explanation, setExplanation] = useState("");
  const [proposedOutcome, setProposedOutcome] = useState<RulingGenerationResponse["outcome"]>();
  const [evaluationConsent, setEvaluationConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  async function submit() {
    if (!session) return;
    setSubmitting(true);
    setMessage("");
    try {
      const payload = challengeSubmissionRequestSchema.parse({
        explanation,
        proposedOutcome,
        evaluationConsent,
      });
      const response = await fetch(
        `${apiUrl}/api/rulings/${encodeURIComponent(rulingId)}/challenges`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${session.access_token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );
      const body: unknown = await response.json();
      if (response.status === 409) throw new Error("You already challenged this ruling.");
      if (response.status === 429) throw new Error("You have reached the daily challenge limit.");
      if (!response.ok) throw new Error("The challenge could not be submitted. Try again later.");
      challengeResponseSchema.parse(body);
      setExplanation("");
      setProposedOutcome(undefined);
      setEvaluationConsent(false);
      setMessage("Challenge submitted. You can follow its status below.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The challenge could not be submitted.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        Challenge this ruling
      </Text>
      <Text style={styles.help}>
        Explain what you think was missed. Challenges are reviewed by a person.
      </Text>
      {!session ? (
        <Link href="/sign-in" asChild>
          <Pressable accessibilityRole="button" style={styles.button}>
            <Text style={styles.buttonText}>Sign in to challenge</Text>
          </Pressable>
        </Link>
      ) : (
        <>
          <TextInput
            accessibilityLabel="Challenge explanation"
            multiline
            maxLength={4_000}
            value={explanation}
            onChangeText={setExplanation}
            placeholder="Describe the rule, card text, or game fact you think changes the answer."
            style={styles.input}
          />
          <Text style={styles.help}>Optional suggested outcome</Text>
          <View style={styles.choices}>
            {proposedOutcomes.map((outcome) => (
              <Pressable
                key={outcome ?? "unspecified"}
                accessibilityRole="button"
                accessibilityState={{ selected: proposedOutcome === outcome }}
                onPress={() => setProposedOutcome(outcome)}
                style={[styles.choice, proposedOutcome === outcome && styles.selectedChoice]}
              >
                <Text style={styles.choiceText}>
                  {outcome?.replaceAll("_", " ") ?? "No suggestion"}
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: evaluationConsent }}
            onPress={() => setEvaluationConsent((consent) => !consent)}
            style={styles.consent}
          >
            <Text style={styles.consentMark}>{evaluationConsent ? "☑" : "☐"}</Text>
            <Text style={styles.help}>
              Allow a de-identified scenario from this challenge to be used for regression testing?
              This is optional. Your original question, explanation, and account details are not
              exported.
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={submitting || explanation.trim().length < 10}
            onPress={() => void submit()}
            style={[
              styles.button,
              (submitting || explanation.trim().length < 10) && styles.disabled,
            ]}
          >
            <Text style={styles.buttonText}>{submitting ? "Submitting…" : "Submit challenge"}</Text>
          </Pressable>
          <Link href="/challenges" style={styles.link}>
            View my challenges
          </Link>
        </>
      )}
      {message ? (
        <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.message}>
          {message}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 10, padding: 14, borderRadius: 10, backgroundColor: "#f5f2e9" },
  title: { color: "#18312f", fontSize: 18, fontWeight: "700" },
  help: { color: "#596d67", fontSize: 13, lineHeight: 19 },
  input: {
    minHeight: 110,
    textAlignVertical: "top",
    padding: 12,
    borderWidth: 1,
    borderColor: "#9caaa2",
    borderRadius: 8,
    backgroundColor: "#fff",
  },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  consent: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingVertical: 4 },
  consentMark: { color: "#1f5d50", fontSize: 20, lineHeight: 22 },
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
  button: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    borderRadius: 9,
    backgroundColor: "#1f5d50",
  },
  buttonText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  disabled: { opacity: 0.45 },
  link: { color: "#145da0", textDecorationLine: "underline" },
  message: { color: "#49615c", fontWeight: "600" },
});
