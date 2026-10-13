import { useCallback, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import type { ConversationSummary } from "@mtg-rules/contracts";
import { useAuth } from "../auth/AuthProvider";
import Text from "../ui/Text";
import { colors, fonts } from "../theme";
import { fetchConversations, removeConversation } from "./api";

const outcomeBadges: Record<
  NonNullable<ConversationSummary["lastOutcome"]>,
  { label: string; color: string; background: string }
> = {
  resolved: { label: "Resolved", color: colors.success, background: colors.successSurface },
  conditional: { label: "Conditional", color: colors.warning, background: colors.warningSurface },
  needs_information: { label: "Needs info", color: colors.info, background: colors.infoSurface },
  uncertain: { label: "Uncertain", color: colors.danger, background: colors.dangerSurface },
};

/** The signed-in player's last ten chats with the judge, newest first. */
export default function RecentConversations() {
  const { session } = useAuth();
  const accessToken = session?.access_token;
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [error, setError] = useState("");

  // Refresh whenever the home screen comes back into view, e.g. after a chat.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (!accessToken) {
        setConversations([]);
        return undefined;
      }
      setError("");
      fetchConversations(accessToken)
        .then((result) => {
          if (active) setConversations(result.conversations);
        })
        .catch(() => {
          if (active) setError("Recent questions are unavailable right now.");
        });
      return () => {
        active = false;
      };
    }, [accessToken]),
  );

  async function forget(conversationId: string) {
    if (!accessToken) return;
    const previous = conversations;
    setConversations((current) => current.filter((item) => item.id !== conversationId));
    try {
      await removeConversation(accessToken, conversationId);
    } catch {
      setConversations(previous);
      setError("That chat could not be deleted. Try again.");
    }
  }

  if (!accessToken || (conversations.length === 0 && !error)) return null;

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.title}>
        Recent questions
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {conversations.map((conversation) => {
        const badge = conversation.lastOutcome ? outcomeBadges[conversation.lastOutcome] : null;
        return (
          <View key={conversation.id} style={styles.row}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Continue: ${conversation.title}`}
              onPress={() => router.push({ pathname: "/chat", params: { id: conversation.id } })}
              style={({ pressed }) => [styles.item, pressed && styles.pressed]}
            >
              <View style={styles.itemText}>
                <Text numberOfLines={1} style={styles.itemTitle}>
                  {conversation.title}
                </Text>
                <Text style={styles.meta}>
                  {new Date(conversation.updatedAt).toLocaleDateString()} · {conversation.turnCount}{" "}
                  {conversation.turnCount === 1 ? "answer" : "answers"}
                </Text>
              </View>
              {badge ? (
                <View style={[styles.badge, { backgroundColor: badge.background }]}>
                  <Text style={[styles.badgeText, { color: badge.color }]}>{badge.label}</Text>
                </View>
              ) : null}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Delete chat: ${conversation.title}`}
              hitSlop={6}
              onPress={() => void forget(conversation.id)}
              style={styles.delete}
            >
              <Ionicons name="trash-outline" size={18} color={colors.textSubtle} />
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8, marginTop: 12 },
  title: {
    color: colors.accent,
    fontFamily: fonts.bodySemibold,
    fontSize: 14,
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  error: { color: colors.danger },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  item: {
    flex: 1,
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.75 },
  itemText: { flex: 1, gap: 2 },
  itemTitle: { fontSize: 15 },
  meta: { color: colors.textSubtle, fontSize: 12 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 9 },
  badgeText: { fontSize: 11, fontFamily: fonts.bodySemibold },
  delete: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
});
