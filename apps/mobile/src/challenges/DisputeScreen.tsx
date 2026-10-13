import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  challengeResponseSchema,
  challengeSubmissionRequestSchema,
  persistedRulingResponseSchema,
  type PersistedRulingResponse,
  type RulingGenerationResponse,
} from "@mtg-rules/contracts";
import { useAuth } from "../auth/AuthProvider";
import { apiUrl } from "../api-url";
import { splitVerdict } from "../rulings/verdict-text";
import Text from "../ui/Text";
import TextInput from "../ui/TextInput";
import Loader from "../ui/Loader";
import BrokenGlasses from "../ui/BrokenGlasses";
import { colors, eyebrow, fonts } from "../theme";
import ChallengeRow from "./ChallengeRow";
import { useMyChallenges } from "./useMyChallenges";

type Outcome = RulingGenerationResponse["outcome"];

const outcomeChoices: Array<{ outcome: Outcome; label: string }> = [
  { outcome: "resolved", label: "A different answer" },
  { outcome: "conditional", label: "It depends" },
  { outcome: "needs_information", label: "Needs more facts" },
  { outcome: "uncertain", label: "Not answerable" },
];

const MIN_EXPLANATION = 10;

export default function DisputeScreen({ rulingId }: { rulingId: string | undefined }) {
  const { session } = useAuth();
  const insets = useSafeAreaInsets();
  const [ruling, setRuling] = useState<PersistedRulingResponse | null>(null);
  const [loadError, setLoadError] = useState("");
  const [proposedOutcome, setProposedOutcome] = useState<Outcome>();
  const [explanation, setExplanation] = useState("");
  const [evaluationConsent, setEvaluationConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const { challenges, reload } = useMyChallenges();

  useEffect(() => {
    if (!rulingId) {
      setLoadError("This ruling link is invalid.");
      return undefined;
    }
    let active = true;
    fetch(`${apiUrl}/api/rulings/${encodeURIComponent(rulingId)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return persistedRulingResponseSchema.parse(await response.json());
      })
      .then((result) => {
        if (active) setRuling(result);
      })
      .catch(() => {
        if (active) setLoadError("This ruling could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [rulingId]);

  const canSend =
    Boolean(session) &&
    Boolean(ruling) &&
    !submitting &&
    !sent &&
    explanation.trim().length >= MIN_EXPLANATION;

  async function send() {
    if (!session || !ruling || !canSend) return;
    setSubmitting(true);
    setMessage("");
    try {
      const payload = challengeSubmissionRequestSchema.parse({
        explanation,
        proposedOutcome,
        evaluationConsent,
      });
      const response = await fetch(
        `${apiUrl}/api/rulings/${encodeURIComponent(ruling.rulingId)}/challenges`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${session.access_token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );
      if (response.status === 409) throw new Error("You already disputed this ruling.");
      if (response.status === 429) throw new Error("You have reached today's dispute limit.");
      if (!response.ok) throw new Error("The dispute could not be sent. Try again later.");
      challengeResponseSchema.parse(await response.json());
      setSent(true);
      setMessage("Sent. A judge will review it, and you can follow it under Your disputes.");
      void reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The dispute could not be sent.");
    } finally {
      setSubmitting(false);
    }
  }

  const verdict = ruling ? splitVerdict(ruling.ruling.summary) : null;

  return (
    <SafeAreaView edges={["left", "right"]} style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? insets.top + 44 : 0}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
          <View style={styles.intro}>
            <BrokenGlasses width={112} />
            <Text accessibilityRole="header" style={styles.heading}>
              Tell a judge what’s wrong
            </Text>
            <Text style={styles.lead}>
              A person reviews every dispute. If they agree, the ruling is corrected.
            </Text>
          </View>

          {loadError ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {loadError}
            </Text>
          ) : null}
          {!ruling && !loadError ? <Loader accessibilityLabel="Loading the ruling" /> : null}

          {ruling && verdict ? (
            <View style={styles.rulingCard}>
              <Ionicons name="document-text-outline" size={18} color={colors.textMuted} />
              <View style={styles.rulingText}>
                <Text numberOfLines={2} style={styles.rulingHeadline}>
                  {verdict.headline ?? ruling.ruling.summary}
                </Text>
                <Text numberOfLines={1} style={styles.rulingMeta}>
                  {ruling.question} · version {ruling.version}
                </Text>
              </View>
            </View>
          ) : null}

          {!session ? (
            <View style={styles.signIn}>
              <Text style={styles.lead}>
                Sign in so a judge can tell you what they decide about your dispute.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push("/sign-in")}
                style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
              >
                <Text style={styles.secondaryText}>Sign in</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.section} accessibilityRole="radiogroup">
                <Text style={eyebrow}>The ruling should be</Text>
                <View style={styles.choices}>
                  {outcomeChoices.map((choice) => {
                    const selected = proposedOutcome === choice.outcome;
                    return (
                      <Pressable
                        key={choice.outcome}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: selected }}
                        accessibilityHint={selected ? "Tap again to clear." : undefined}
                        onPress={() => setProposedOutcome(selected ? undefined : choice.outcome)}
                        style={({ pressed }) => [
                          styles.choice,
                          selected && styles.choiceSelected,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>
                          {choice.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={styles.helper}>Optional. Tap again to clear.</Text>
              </View>

              <View style={styles.section}>
                <Text style={eyebrow}>Why</Text>
                <TextInput
                  accessibilityLabel="Why the ruling is wrong"
                  editable={!sent}
                  multiline
                  maxLength={4_000}
                  onChangeText={setExplanation}
                  placeholder="Which step is wrong, and which rule or official ruling says otherwise?"
                  style={styles.input}
                  textAlignVertical="top"
                  value={explanation}
                />
              </View>

              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: evaluationConsent }}
                onPress={() => setEvaluationConsent((value) => !value)}
                style={styles.consent}
              >
                <Ionicons
                  name={evaluationConsent ? "checkbox" : "square-outline"}
                  size={22}
                  color={evaluationConsent ? colors.accent : colors.textMuted}
                />
                <Text style={styles.consentText}>
                  Let a de-identified scenario from this dispute be used to test the judge.
                  Optional; your original question, explanation and account are not exported.
                </Text>
              </Pressable>
            </>
          )}

          {message ? (
            <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.message}>
              {message}
            </Text>
          ) : null}

          {challenges && challenges.length > 0 ? (
            <View style={styles.section}>
              <Text style={eyebrow}>Your disputes</Text>
              {challenges.slice(0, 5).map((challenge) => (
                <ChallengeRow key={challenge.challengeId} challenge={challenge} />
              ))}
            </View>
          ) : null}
        </ScrollView>

        {session ? (
          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSend }}
              disabled={!canSend}
              onPress={() => void send()}
              style={({ pressed }) => [
                styles.primary,
                !canSend && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              {submitting ? (
                <Loader accessibilityLabel="Sending" size={8} color={colors.accentInk} />
              ) : (
                <Text style={styles.primaryText}>{sent ? "Sent" : "Send to a judge"}</Text>
              )}
            </Pressable>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  page: {
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 28,
    gap: 22,
  },
  intro: { gap: 10 },
  heading: { fontFamily: fonts.display, fontSize: 28, lineHeight: 33 },
  lead: { color: colors.textSoft, fontSize: 14.5, lineHeight: 21 },
  error: { color: colors.danger },
  rulingCard: {
    flexDirection: "row",
    gap: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.surface,
  },
  rulingText: { flex: 1, gap: 3 },
  rulingHeadline: { fontFamily: fonts.display, fontSize: 17, lineHeight: 22 },
  rulingMeta: { color: colors.textMuted, fontSize: 12.5 },
  signIn: { gap: 12 },
  section: { gap: 10 },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
  },
  choiceSelected: { borderColor: colors.accent, backgroundColor: colors.accentSurface },
  choiceText: { color: colors.textSoft, fontSize: 14 },
  choiceTextSelected: { color: colors.accentText },
  helper: { color: colors.textMuted, fontSize: 12.5 },
  input: {
    minHeight: 120,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
  consent: { flexDirection: "row", alignItems: "flex-start", gap: 10, minHeight: 44 },
  consentText: { flex: 1, color: colors.textSoft, fontSize: 13.5, lineHeight: 20 },
  message: { color: colors.textSoft, fontFamily: fonts.bodyMedium, fontSize: 14 },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.background,
  },
  primary: {
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 26,
    backgroundColor: colors.accent,
  },
  primaryText: { color: colors.accentInk, fontFamily: fonts.bodySemibold, fontSize: 16 },
  secondary: {
    alignSelf: "flex-start",
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
  },
  secondaryText: { fontSize: 14 },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
});
