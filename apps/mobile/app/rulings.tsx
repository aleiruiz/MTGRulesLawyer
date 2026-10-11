import { useEffect, useState } from "react";
import { useLocalSearchParams, Link } from "expo-router";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { persistedRulingResponseSchema, type PersistedRulingResponse } from "@mtg-rules/contracts";
import { apiUrl } from "../src/api-url";
import ChallengeForm from "../src/challenges/ChallengeForm";

const rulingIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default function PublicRulingScreen() {
  const { id, version } = useLocalSearchParams<{ id?: string; version?: string }>();
  const [ruling, setRuling] = useState<PersistedRulingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setRuling(null);
    setError(null);

    if (
      typeof id !== "string" ||
      !rulingIdPattern.test(id) ||
      (version !== undefined && (!/^\d+$/.test(version) || Number(version) < 1))
    ) {
      setError("This ruling link is invalid.");
      setLoading(false);
      return () => {
        active = false;
      };
    }

    setLoading(true);
    const versionQuery = version === undefined ? "" : `?version=${encodeURIComponent(version)}`;
    void fetch(`${apiUrl}/api/rulings/${encodeURIComponent(id)}${versionQuery}`)
      .then(async (response) => {
        if (response.status === 404) throw new Error("This ruling could not be found.");
        if (!response.ok) throw new Error("The ruling is temporarily unavailable.");
        return persistedRulingResponseSchema.parse(await response.json());
      })
      .then((result) => {
        if (active) setRuling(result);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(
            reason instanceof Error ? reason.message : "The ruling is temporarily unavailable.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [id, version]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.notice}>
          Rules Lens is unofficial Fan Content permitted under the Fan Content Policy. Not
          approved/endorsed by Wizards. Portions of the materials used are property of Wizards of
          the Coast. ©Wizards of the Coast LLC.
        </Text>
        <Text accessibilityRole="header" style={styles.title}>
          Shared ruling
        </Text>
        {loading ? <Text accessibilityLiveRegion="polite">Loading ruling…</Text> : null}
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
        {ruling ? (
          <View style={styles.card}>
            <Text style={styles.outcome}>{ruling.ruling.outcome.replaceAll("_", " ")}</Text>
            <Text style={styles.question}>{ruling.question}</Text>
            <Text style={styles.summary}>{ruling.ruling.summary}</Text>
            <Text style={styles.meta}>
              Rules snapshot {ruling.ruling.snapshot.version} ·{" "}
              {ruling.ruling.snapshot.activatedAt
                ? new Date(ruling.ruling.snapshot.activatedAt).toLocaleDateString()
                : "activation date unavailable"}
            </Text>
            {ruling.ruling.assumptions.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Assumptions</Text>
                {ruling.ruling.assumptions.map((assumption, index) => (
                  <Text key={`${index}-${assumption}`} style={styles.body}>
                    {assumption}
                  </Text>
                ))}
              </View>
            ) : null}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Reasoning</Text>
              {ruling.ruling.reasoningSteps.map((step, index) => (
                <Text key={`${index}-${step.text}`} style={styles.body}>
                  {index + 1}. {step.text}
                </Text>
              ))}
            </View>
            {ruling.ruling.clarificationQuestions.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Questions to clarify</Text>
                {ruling.ruling.clarificationQuestions.map((question, index) => (
                  <Text key={`${index}-${question}`} style={styles.body}>
                    {question}
                  </Text>
                ))}
              </View>
            ) : null}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Evidence</Text>
              {ruling.ruling.citations.map((citation, index) => (
                <View key={`${citation.sourceId}-${citation.id}-${index}`} style={styles.citation}>
                  <Text style={styles.citationTitle}>
                    [{index + 1}] {citation.label}
                  </Text>
                  <Text
                    accessibilityRole="link"
                    onPress={() => void Linking.openURL(citation.sourceUrl)}
                    style={styles.link}
                  >
                    Open source
                  </Text>
                </View>
              ))}
            </View>
            <Text style={styles.meta}>
              Ruling {ruling.rulingId} · version {ruling.version} ·{" "}
              {new Date(ruling.createdAt).toLocaleDateString()}
            </Text>
            <Link href="/" style={styles.link}>
              Ask a rules question
            </Link>
            <ChallengeForm rulingId={ruling.rulingId} />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#f4f1e8" },
  container: { width: "100%", maxWidth: 760, alignSelf: "center", padding: 20, gap: 16 },
  brand: { color: "#5d3f1c", fontSize: 15, fontWeight: "700" },
  notice: { color: "#5b5a55", fontSize: 13 },
  title: { color: "#17212b", fontSize: 30, fontWeight: "800" },
  error: { color: "#9c2f25", fontSize: 16 },
  card: { backgroundColor: "#fff", borderRadius: 16, padding: 20, gap: 14 },
  outcome: { color: "#386641", fontSize: 14, fontWeight: "800", textTransform: "uppercase" },
  question: { color: "#17212b", fontSize: 20, fontWeight: "700" },
  summary: { color: "#17212b", fontSize: 18, lineHeight: 27 },
  meta: { color: "#5b5a55", fontSize: 13 },
  section: { borderTopWidth: 1, borderTopColor: "#e6e1d6", paddingTop: 14, gap: 10 },
  sectionTitle: { color: "#17212b", fontSize: 17, fontWeight: "700" },
  body: { color: "#303b45", fontSize: 15, lineHeight: 23 },
  citation: { backgroundColor: "#f7f6f2", borderRadius: 10, padding: 12, gap: 8 },
  citationTitle: { color: "#17212b", fontWeight: "700" },
  link: { color: "#145da0", fontSize: 15, textDecorationLine: "underline" },
});
