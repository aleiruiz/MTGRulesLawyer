import { useCallback, useEffect, useState } from "react";
import { Link } from "expo-router";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import Text from "../src/ui/Text";
import { SafeAreaView } from "react-native-safe-area-context";
import { myChallengesResponseSchema, type MyChallengesResponse } from "@mtg-rules/contracts";
import { useAuth } from "../src/auth/AuthProvider";
import { apiUrl } from "../src/api-url";
import { colors, fonts } from "../src/theme";

export default function MyChallengesScreen() {
  const { session } = useAuth();
  const [result, setResult] = useState<MyChallengesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadChallenges = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${apiUrl}/api/me/challenges`, {
        headers: { authorization: `Bearer ${session.access_token}` },
      });
      if (!response.ok) throw new Error("Your challenges could not be loaded.");
      setResult(myChallengesResponseSchema.parse(await response.json()));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Your challenges could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void loadChallenges();
  }, [loadChallenges]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.page}>
        <Text accessibilityRole="header" style={styles.title}>
          My challenges
        </Text>
        {!session ? (
          <Link href="/sign-in" style={styles.link}>
            Sign in to view your challenges
          </Link>
        ) : (
          <>
            <Pressable
              accessibilityRole="button"
              disabled={loading}
              onPress={() => void loadChallenges()}
              style={styles.refresh}
            >
              <Text style={styles.refreshText}>{loading ? "Loading…" : "Refresh status"}</Text>
            </Pressable>
            {error ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            ) : null}
            {result?.challenges.length === 0 ? <Text>No challenges yet.</Text> : null}
            {result?.challenges.map((challenge) => (
              <View key={challenge.challengeId} style={styles.card}>
                <Text style={styles.status}>{challenge.status.replaceAll("_", " ")}</Text>
                <Text style={styles.question}>{challenge.question}</Text>
                <Text>{challenge.explanation}</Text>
                {challenge.proposedOutcome ? (
                  <Text>Suggested outcome: {challenge.proposedOutcome.replaceAll("_", " ")}</Text>
                ) : null}
                {challenge.latestInformationRequest ? (
                  <View accessibilityLiveRegion="polite" style={styles.infoRequest}>
                    <Text style={styles.infoTitle}>The reviewer needs more information</Text>
                    <Text>{challenge.latestInformationRequest.reason}</Text>
                    <Text style={styles.date}>
                      Requested{" "}
                      {new Date(challenge.latestInformationRequest.createdAt).toLocaleDateString()}
                    </Text>
                  </View>
                ) : null}
                {challenge.latestDecision ? (
                  <View accessibilityLiveRegion="polite" style={styles.infoRequest}>
                    <Text style={styles.infoTitle}>
                      Challenge{" "}
                      {challenge.latestDecision.decision === "approve" ? "approved" : "rejected"}
                    </Text>
                    <Text>{challenge.latestDecision.reason}</Text>
                    {challenge.latestDecision.correctedRulingVersion ? (
                      <Link
                        href={{
                          pathname: "/rulings",
                          params: {
                            id: challenge.rulingId,
                            version: String(challenge.latestDecision.correctedRulingVersion),
                          },
                        }}
                        style={styles.link}
                      >
                        Read the corrected answer
                      </Link>
                    ) : null}
                  </View>
                ) : null}
                <Link
                  href={{
                    pathname: "/rulings",
                    params: { id: challenge.rulingId, version: String(challenge.rulingVersion) },
                  }}
                  style={styles.link}
                >
                  Open original ruling
                </Link>
                <Text style={styles.date}>
                  Submitted {new Date(challenge.createdAt).toLocaleDateString()}
                </Text>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  page: { width: "100%", maxWidth: 760, alignSelf: "center", padding: 20, gap: 14 },
  title: { color: colors.accent, fontFamily: fonts.bodySemibold, fontSize: 28 },
  card: { gap: 8, padding: 16, borderRadius: 12, backgroundColor: colors.surface },
  status: { color: colors.accent, fontWeight: "800", textTransform: "capitalize" },
  question: { color: colors.text, fontSize: 18, fontWeight: "700" },
  infoRequest: { gap: 5, padding: 10, borderRadius: 8, backgroundColor: colors.warningSurface },
  infoTitle: { color: colors.warning, fontWeight: "700" },
  date: { color: colors.textMuted, fontSize: 13 },
  refresh: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: colors.accent,
  },
  refreshText: { color: colors.accentInk, fontWeight: "700" },
  error: { color: colors.danger },
  link: { color: colors.accent, textDecorationLine: "underline" },
});
