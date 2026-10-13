import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../src/auth/AuthProvider";
import { challengeStatus } from "../src/challenges/challenge-status";
import { useMyChallenges } from "../src/challenges/useMyChallenges";
import Loader from "../src/ui/Loader";
import Text from "../src/ui/Text";
import { colors, eyebrow, fonts } from "../src/theme";
import { useT } from "../src/i18n/LanguageProvider";

export default function MyChallengesScreen() {
  const { session } = useAuth();
  const { challenges, loading, error, reload } = useMyChallenges();
  const { t, locale } = useT();

  return (
    <SafeAreaView edges={["bottom", "left", "right"]} style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.page}
        refreshControl={
          session ? (
            <RefreshControl
              refreshing={loading && challenges !== null}
              onRefresh={() => void reload()}
              tintColor={colors.accent}
              colors={[colors.accent]}
            />
          ) : undefined
        }
      >
        <View style={styles.intro}>
          <Text accessibilityRole="header" style={styles.heading}>
            {t.disputes.heading}
          </Text>
          <Text style={styles.lead}>{t.disputes.lead}</Text>
        </View>

        {!session ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/sign-in")}
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
          >
            <Text style={styles.secondaryText}>{t.disputes.signInToSee}</Text>
          </Pressable>
        ) : null}
        {session && challenges === null && loading ? (
          <Loader accessibilityLabel={t.disputes.loading} />
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
        {challenges?.length === 0 ? <Text style={styles.lead}>{t.disputes.none}</Text> : null}

        {challenges?.map((challenge) => {
          const status = challengeStatus(challenge);
          const decision = challenge.latestDecision;
          return (
            <View key={challenge.challengeId} style={styles.card}>
              <View style={[styles.pill, { backgroundColor: status.background }]}>
                <Text style={[styles.pillText, { color: status.color }]}>{status.label}</Text>
              </View>
              <Text style={styles.question}>{challenge.question}</Text>
              <Text style={styles.explanation}>{challenge.explanation}</Text>

              {challenge.status === "needs_information" && challenge.latestInformationRequest ? (
                <View accessibilityLiveRegion="polite" style={styles.note}>
                  <Text style={[eyebrow, { color: colors.info }]}>{t.disputes.judgeAsks}</Text>
                  <Text style={styles.noteText}>{challenge.latestInformationRequest.reason}</Text>
                </View>
              ) : null}

              {decision ? (
                <View accessibilityLiveRegion="polite" style={styles.note}>
                  <Text style={eyebrow}>
                    {decision.decision === "approve"
                      ? t.disputes.judgeAgreed
                      : t.disputes.judgeDisagreed}
                  </Text>
                  <Text style={styles.noteText}>{decision.reason}</Text>
                  {decision.correctedRulingVersion ? (
                    <Pressable
                      accessibilityRole="link"
                      onPress={() =>
                        router.push({
                          pathname: "/rulings",
                          params: {
                            id: decision.correctedRulingId ?? challenge.rulingId,
                            version: String(decision.correctedRulingVersion),
                          },
                        })
                      }
                      style={styles.linkButton}
                    >
                      <Text style={styles.link}>{t.disputes.readCorrected}</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}

              <View style={styles.footer}>
                <Text style={styles.date}>
                  {t.disputes.sentOn(new Date(challenge.createdAt).toLocaleDateString(locale))}
                </Text>
                <Pressable
                  accessibilityRole="link"
                  onPress={() =>
                    router.push({
                      pathname: "/rulings",
                      params: { id: challenge.rulingId, version: String(challenge.rulingVersion) },
                    })
                  }
                  style={styles.linkButton}
                >
                  <Text style={styles.link}>{t.disputes.original}</Text>
                </Pressable>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  page: {
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 32,
    gap: 16,
  },
  intro: { gap: 8, paddingBottom: 6 },
  heading: { fontFamily: fonts.display, fontSize: 28, lineHeight: 33 },
  lead: { color: colors.textSoft, fontSize: 14.5, lineHeight: 21 },
  error: { color: colors.danger },
  card: {
    gap: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    backgroundColor: colors.surface,
  },
  pill: { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  pillText: { fontFamily: fonts.bodyMedium, fontSize: 12 },
  question: { fontFamily: fonts.display, fontSize: 18, lineHeight: 24 },
  explanation: { color: colors.textSoft, fontSize: 14, lineHeight: 20 },
  note: {
    gap: 6,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  noteText: { fontSize: 14.5, lineHeight: 21 },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  date: { color: colors.textMuted, fontSize: 12.5 },
  linkButton: { minHeight: 44, justifyContent: "center" },
  link: { color: colors.accent, fontSize: 14 },
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
  pressed: { opacity: 0.75 },
});
