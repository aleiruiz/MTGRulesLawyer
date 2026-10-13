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
import Text from "../src/ui/Text";
import {
  aiUsageDashboardResponseSchema,
  type AiUsageDashboardResponse,
} from "@mtg-rules/contracts";
import { adminAccessMessage, readAdminAccessDenial } from "../src/auth/admin-access";
import { useAuth } from "../src/auth/AuthProvider";
import { apiUrl } from "../src/api-url";
import { useT } from "../src/i18n/LanguageProvider";
import { strings } from "../src/i18n/core";

const RANGES = [7, 14, 30] as const;
type CallStats = Omit<AiUsageDashboardResponse["byKind"][number], "kind">;

/** Micro-dollars as dollars: cents from one cent up, otherwise 4 decimals ($0.0016). */
function dollars(micros: number): string {
  const value = micros / 1_000_000;
  return `$${value >= 0.01 || value === 0 ? value.toFixed(2) : value.toFixed(4)}`;
}

function seconds(ms: number | null): string {
  return ms === null ? "—" : `${(ms / 1_000).toFixed(1)} s`;
}

/** Admin-only view of the judge's AI calls: spend against the daily cap, speed and failures. */
export default function AiUsageScreen() {
  const { session, loading: authLoading } = useAuth();
  const { t } = useT();
  const [days, setDays] = useState<(typeof RANGES)[number]>(14);
  const [usage, setUsage] = useState<AiUsageDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [needsVerification, setNeedsVerification] = useState(false);

  const load = useCallback(async () => {
    if (!session) {
      setUsage(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setMessage("");
    setNeedsVerification(false);
    try {
      const response = await fetch(`${apiUrl}/api/admin/ai-usage?days=${days}`, {
        headers: { authorization: `Bearer ${session.access_token}` },
      });
      const denial = await readAdminAccessDenial(response);
      if (denial) {
        setNeedsVerification(denial !== "not_admin");
        throw new Error(adminAccessMessage(denial));
      }
      if (!response.ok) throw new Error(strings().aiUsage.unavailable);
      setUsage(aiUsageDashboardResponseSchema.parse(await response.json()));
    } catch (error) {
      setUsage(null);
      setMessage(error instanceof Error ? error.message : strings().aiUsage.unavailable);
    } finally {
      setLoading(false);
    }
  }, [session, days]);

  useFocusEffect(
    useCallback(() => {
      if (!authLoading) void load();
    }, [authLoading, load]),
  );

  const failedCount = (stats: CallStats) =>
    Object.values(stats.failures).reduce((total, count) => total + count, 0);

  const statsBlock = (stats: CallStats) => (
    <View style={styles.statsGrid}>
      <Stat label={t.aiUsage.median} value={seconds(stats.medianMs)} />
      <Stat label={t.aiUsage.p95} value={seconds(stats.p95Ms)} />
      <Stat label={t.aiUsage.slowest} value={seconds(stats.maxMs)} />
      <Stat
        label={t.aiUsage.outputTokens}
        value={stats.averageOutputTokens === null ? "—" : String(stats.averageOutputTokens)}
      />
      <Stat
        label={t.aiUsage.failed}
        value={String(failedCount(stats))}
        warn={failedCount(stats) > 0}
      />
    </View>
  );

  const failureLines = (stats: CallStats) =>
    (Object.keys(stats.failures) as Array<keyof CallStats["failures"]>)
      .filter((failure) => stats.failures[failure] > 0)
      .map((failure) => (
        <Text key={failure} style={styles.warning}>
          {`${t.aiUsage.failures[failure]}: ${stats.failures[failure]}`}
        </Text>
      ));

  const maxDailyCost = Math.max(1, ...(usage?.daily.map((day) => day.countedCostMicros) ?? []));
  const todayShare = usage
    ? Math.min(1, usage.today.countedCostMicros / usage.today.dailyLimitMicros)
    : 0;
  const nearCap = usage ? usage.today.countedCostMicros >= usage.today.alertThresholdMicros : false;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text accessibilityRole="header" style={styles.title}>
          {t.aiUsage.title}
        </Text>

        <View style={styles.ranges}>
          {RANGES.map((range) => (
            <Pressable
              key={range}
              accessibilityRole="button"
              accessibilityLabel={t.aiUsage.rangeLabel(range)}
              accessibilityState={{ selected: range === days }}
              onPress={() => setDays(range)}
              style={[styles.range, range === days && styles.rangeSelected]}
            >
              <Text style={range === days ? styles.rangeTextSelected : styles.rangeText}>
                {t.aiUsage.range(range)}
              </Text>
            </Pressable>
          ))}
        </View>

        {loading || authLoading ? (
          <ActivityIndicator accessibilityLabel={t.aiUsage.loading} />
        ) : null}
        {!session && !authLoading ? (
          <Text style={styles.message}>{t.review.signInAdmin}</Text>
        ) : null}
        {message ? <Text style={styles.message}>{message}</Text> : null}
        {needsVerification ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/admin-verify")}
            style={styles.button}
          >
            <Text style={styles.buttonText}>{t.review.verify}</Text>
          </Pressable>
        ) : null}

        {usage ? (
          <>
            <View style={styles.card}>
              <Text style={styles.eyebrow}>{t.aiUsage.today}</Text>
              <Text style={styles.hero}>{dollars(usage.today.countedCostMicros)}</Text>
              <Text style={styles.detail}>
                {t.aiUsage.ofCap(
                  dollars(usage.today.countedCostMicros),
                  dollars(usage.today.dailyLimitMicros),
                )}
                {" · "}
                {t.aiUsage.calls(usage.today.calls)}
              </Text>
              <View
                style={styles.meter}
                accessibilityRole="progressbar"
                accessibilityValue={{ min: 0, max: 100, now: Math.round(todayShare * 100) }}
              >
                <View
                  style={[
                    styles.meterFill,
                    { width: `${todayShare * 100}%` },
                    nearCap && styles.meterFillWarn,
                  ]}
                />
              </View>
              {nearCap ? <Text style={styles.warning}>{`⚠ ${t.aiUsage.nearCap}`}</Text> : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.eyebrow}>{t.aiUsage.settings}</Text>
              <Text style={styles.detail}>
                {t.aiUsage.settingsLine(
                  usage.settings.model,
                  usage.settings.reasoningEffort,
                  usage.settings.maxOutputTokens,
                  Math.round(usage.settings.timeoutMs / 1_000),
                )}
              </Text>
              {!usage.settings.costRatesConfigured ? (
                <Text style={styles.warning}>
                  {`⚠ ${t.aiUsage.noCostRates(dollars(usage.settings.reservedCostMicros))}`}
                </Text>
              ) : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.eyebrow}>{t.aiUsage.perDay}</Text>
              {usage.daily.length === 0 ? (
                <Text style={styles.detail}>{t.aiUsage.perDayEmpty}</Text>
              ) : (
                usage.daily.map((day) => (
                  <View
                    key={day.date}
                    accessible
                    accessibilityLabel={t.aiUsage.dayLabel(
                      day.date,
                      dollars(day.countedCostMicros),
                      day.calls,
                      day.failures,
                    )}
                    style={styles.dayRow}
                  >
                    <Text style={styles.dayDate}>{day.date.slice(5)}</Text>
                    <View style={styles.dayTrack}>
                      <View
                        style={[
                          styles.dayBar,
                          { width: `${(day.countedCostMicros / maxDailyCost) * 100}%` },
                        ]}
                      />
                    </View>
                    <Text style={styles.dayValue}>
                      {`${dollars(day.countedCostMicros)} · ${day.calls}`}
                      {day.failures > 0 ? ` · ⚠ ${day.failures}` : ""}
                    </Text>
                  </View>
                ))
              )}
            </View>

            <View style={styles.card}>
              <Text style={styles.eyebrow}>{t.aiUsage.byKind}</Text>
              {usage.byKind.map((stats) => (
                <View key={stats.kind} style={styles.group}>
                  <Text style={styles.groupTitle}>
                    {`${t.aiUsage.kinds[stats.kind]} · ${t.aiUsage.calls(stats.calls)}`}
                  </Text>
                  {statsBlock(stats)}
                  {failureLines(stats)}
                </View>
              ))}
            </View>

            <View style={styles.card}>
              <Text style={styles.eyebrow}>{t.aiUsage.bySetting}</Text>
              {usage.rulingsBySetting.map((stats) => (
                <View key={`${stats.model}-${stats.reasoningEffort}`} style={styles.group}>
                  <Text style={styles.groupTitle}>
                    {stats.model && stats.reasoningEffort
                      ? `${stats.model} · ${stats.reasoningEffort}`
                      : t.aiUsage.unknownSetting}
                    {` · ${t.aiUsage.calls(stats.calls)}`}
                  </Text>
                  {statsBlock(stats)}
                  {failureLines(stats)}
                </View>
              ))}
            </View>

            <View style={styles.card}>
              <Text style={styles.eyebrow}>{t.aiUsage.outcomes}</Text>
              <View style={styles.statsGrid}>
                {(
                  Object.keys(usage.rulingOutcomes) as Array<
                    keyof AiUsageDashboardResponse["rulingOutcomes"]
                  >
                ).map((outcome) => (
                  <Stat
                    key={outcome}
                    label={t.verdict.outcomes[outcome]}
                    value={String(usage.rulingOutcomes[outcome])}
                  />
                ))}
              </View>
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, warn && styles.statValueWarn]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  container: { width: "100%", maxWidth: 800, alignSelf: "center", padding: 18, gap: 14 },
  title: { color: colors.accent, fontFamily: fonts.bodySemibold, fontSize: 28 },
  ranges: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  range: {
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
  },
  rangeSelected: { borderColor: colors.accent, backgroundColor: colors.accentSurface },
  rangeText: { color: colors.textSoft, fontSize: 14 },
  rangeTextSelected: { color: colors.accentText, fontSize: 14 },
  card: { gap: 10, padding: 16, borderRadius: 14, backgroundColor: colors.surface },
  eyebrow: {
    color: colors.textMuted,
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  hero: { fontFamily: fonts.monoMedium, fontSize: 32 },
  detail: { color: colors.textSoft, fontSize: 14, lineHeight: 20 },
  warning: { color: colors.warning, fontSize: 13.5, lineHeight: 19 },
  meter: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceSunken, overflow: "hidden" },
  meterFill: { height: 8, borderRadius: 4, backgroundColor: colors.accent },
  meterFillWarn: { backgroundColor: colors.warning },
  dayRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  dayDate: { width: 44, color: colors.textMuted, fontFamily: fonts.mono, fontSize: 12 },
  dayTrack: { flex: 1, height: 10, justifyContent: "center" },
  dayBar: { minWidth: 2, height: 10, borderRadius: 4, backgroundColor: colors.accent },
  dayValue: { minWidth: 110, color: colors.textSoft, fontFamily: fonts.mono, fontSize: 12 },
  group: { gap: 8, paddingTop: 4 },
  groupTitle: { fontFamily: fonts.bodySemibold, fontSize: 15 },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stat: {
    minWidth: 96,
    flexGrow: 1,
    gap: 2,
    padding: 10,
    borderRadius: 10,
    backgroundColor: colors.surfaceRaised,
  },
  statValue: { fontFamily: fonts.monoMedium, fontSize: 16 },
  statValueWarn: { color: colors.warning },
  statLabel: { color: colors.textMuted, fontSize: 12 },
  message: { color: colors.warning, fontFamily: fonts.bodySemibold },
  button: {
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: colors.accent,
  },
  buttonText: { color: colors.accentInk, fontFamily: fonts.bodySemibold },
});
