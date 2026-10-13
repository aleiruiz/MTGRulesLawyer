import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { sourceStatusResponseSchema, type SourceStatusResponse } from "@mtg-rules/contracts";
import { apiUrl } from "../api-url";
import Text from "../ui/Text";
import { rulesDate } from "../rulings/verdict-text";
import { colors } from "../theme";

const shortDate: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };

function cardsDate(checkedAt: string | null): string | null {
  if (!checkedAt) return null;
  const date = new Date(checkedAt);
  if (date.toDateString() === new Date().toDateString()) return "today";
  return date.toLocaleDateString(undefined, shortDate);
}

/** Which Comprehensive Rules and card data the judge reads, so players can trust the answer. */
export default function SourcesFooter() {
  const [status, setStatus] = useState<SourceStatusResponse | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`${apiUrl}/api/sources/status`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: unknown) => {
        const parsed = sourceStatusResponseSchema.safeParse(body);
        if (active && parsed.success) setStatus(parsed.data);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (!status) return null;
  const rules = status.sources.find((source) => source.kind === "COMPREHENSIVE_RULES");
  const cards = status.sources.find((source) => source.kind === "ORACLE_CARDS");
  const stale = status.sources.some((source) => source.stale);
  const parts = [
    rules && rulesDate(rules.sourceVersion)
      ? `Comprehensive Rules · ${rulesDate(rules.sourceVersion)}`
      : null,
    cards && cardsDate(cards.checkedAt)
      ? `Cards and official rulings checked ${cardsDate(cards.checkedAt)}`
      : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;

  return (
    <View style={styles.footer}>
      <View style={[styles.dot, { backgroundColor: stale ? colors.warning : colors.successDot }]} />
      <Text style={styles.text}>
        {parts.join(" · ")}
        {stale ? " · An update is overdue" : ""}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  dot: { width: 7, height: 7, marginTop: 5, borderRadius: 4 },
  text: { flex: 1, color: colors.textMuted, fontSize: 12, lineHeight: 17 },
});
