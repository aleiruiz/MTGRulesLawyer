import { useEffect, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { persistedRulingResponseSchema, type PersistedRulingResponse } from "@mtg-rules/contracts";
import { apiUrl } from "../src/api-url";
import JudgeMessage from "../src/chat/JudgeMessage";
import Loader from "../src/ui/Loader";
import Text from "../src/ui/Text";
import { colors, fonts } from "../src/theme";
import { useT } from "../src/i18n/LanguageProvider";
import { strings } from "../src/i18n/core";

const rulingIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default function PublicRulingScreen() {
  const { t, locale } = useT();
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
      setError(strings().shared.invalid);
      setLoading(false);
      return () => {
        active = false;
      };
    }

    setLoading(true);
    const versionQuery = version === undefined ? "" : `?version=${encodeURIComponent(version)}`;
    void fetch(`${apiUrl}/api/rulings/${encodeURIComponent(id)}${versionQuery}`)
      .then(async (response) => {
        if (response.status === 404) throw new Error(strings().shared.notFound);
        if (!response.ok) throw new Error(strings().shared.unavailable);
        return persistedRulingResponseSchema.parse(await response.json());
      })
      .then((result) => {
        if (active) setRuling(result);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : strings().shared.unavailable);
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
    <SafeAreaView edges={["bottom", "left", "right"]} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.page}>
        {loading ? <Loader accessibilityLabel={t.shared.loading} /> : null}
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
        {ruling ? (
          <>
            <View style={styles.questionBubble}>
              <Text selectable style={styles.question}>
                {ruling.question}
              </Text>
            </View>
            <JudgeMessage
              result={ruling}
              onDispute={
                version === undefined
                  ? () => router.push({ pathname: "/dispute", params: { ruling: ruling.rulingId } })
                  : undefined
              }
            />
            <Text selectable style={styles.meta}>
              {t.shared.versionLine(
                ruling.version,
                new Date(ruling.createdAt).toLocaleDateString(locale),
              )}
            </Text>
          </>
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace("/")}
          style={({ pressed }) => [styles.ask, pressed && styles.pressed]}
        >
          <Text style={styles.askText}>{t.shared.askOwn}</Text>
        </Pressable>
        <Text style={styles.notice}>{t.shared.notice}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  page: {
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 32,
    gap: 20,
  },
  error: { color: colors.danger, fontSize: 16 },
  questionBubble: {
    alignSelf: "flex-end",
    maxWidth: "85%",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 18,
    borderBottomRightRadius: 4,
    backgroundColor: colors.surfaceRaised,
  },
  question: { fontSize: 15, lineHeight: 22 },
  meta: { color: colors.textSubtle, fontSize: 12 },
  ask: {
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 24,
    backgroundColor: colors.accent,
  },
  askText: { color: colors.accentInk, fontFamily: fonts.bodySemibold, fontSize: 15 },
  pressed: { opacity: 0.75 },
  notice: { color: colors.textSubtle, fontSize: 11.5, lineHeight: 16 },
});
