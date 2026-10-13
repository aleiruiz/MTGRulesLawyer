import { useCallback, useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import type { ConversationSummary } from "@mtg-rules/contracts";
import { useAuth } from "../auth/AuthProvider";
import Text from "../ui/Text";
import { colors, eyebrow } from "../theme";
import { fetchConversations, removeConversation } from "../chat/api";

type Outcome = NonNullable<ConversationSummary["lastOutcome"]>;

/** The dot beside a ruling says how sure the judge was. */
export const outcomeDots: Record<Outcome, { color: string; label: string }> = {
  resolved: { color: colors.successDot, label: "Resolved" },
  conditional: { color: colors.accent, label: "Depends on the situation" },
  needs_information: { color: colors.infoDot, label: "Needs more information" },
  uncertain: { color: colors.textSubtle, label: "Uncertain" },
};

export interface RecentConversationsState {
  conversations: ConversationSummary[];
  /** False until the first load finishes. */
  loaded: boolean;
  error: string;
  forget: (conversationId: string) => Promise<void>;
}

/** The signed-in player's last ten chats with the judge, newest first. */
export function useRecentConversations(): RecentConversationsState {
  const { session } = useAuth();
  const accessToken = session?.access_token;
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  // Refresh whenever the home screen comes back into view, e.g. after a chat.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (!accessToken) {
        setConversations([]);
        setLoaded(true);
        return undefined;
      }
      setError("");
      fetchConversations(accessToken)
        .then((result) => {
          if (active) setConversations(result.conversations);
        })
        .catch(() => {
          if (active) setError("Recent rulings are unavailable right now.");
        })
        .finally(() => {
          if (active) setLoaded(true);
        });
      return () => {
        active = false;
      };
    }, [accessToken]),
  );

  const forget = useCallback(
    async (conversationId: string) => {
      if (!accessToken) return;
      const previous = conversations;
      setConversations((current) => current.filter((item) => item.id !== conversationId));
      try {
        await removeConversation(accessToken, conversationId);
      } catch {
        setConversations(previous);
        setError("That ruling could not be deleted. Try again.");
      }
    },
    [accessToken, conversations],
  );

  return { conversations, loaded, error, forget };
}

function whenLabel(updatedAt: string): string {
  const date = new Date(updatedAt);
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  if (hours < 48) return "yesterday";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function confirmForget(conversation: ConversationSummary, forget: (id: string) => void) {
  Alert.alert("Delete this ruling?", conversation.title, [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: () => forget(conversation.id) },
  ]);
}

export default function RecentRulings({ conversations, error, forget }: RecentConversationsState) {
  if (conversations.length === 0 && !error) return null;

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.title}>
        Recent rulings
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {conversations.map((conversation) => {
        const dot = conversation.lastOutcome ? outcomeDots[conversation.lastOutcome] : null;
        const followUps = conversation.turnCount - 1;
        const meta = [
          whenLabel(conversation.updatedAt),
          followUps > 0 ? `${followUps} follow-up${followUps === 1 ? "" : "s"}` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <Pressable
            key={conversation.id}
            accessibilityRole="button"
            accessibilityLabel={`${dot ? `${dot.label}: ` : ""}${conversation.title}, ${meta}`}
            accessibilityHint="Opens the ruling. Long press to delete it."
            accessibilityActions={[{ name: "delete", label: "Delete ruling" }]}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === "delete") {
                confirmForget(conversation, (id) => void forget(id));
              }
            }}
            onLongPress={() => confirmForget(conversation, (id) => void forget(id))}
            onPress={() => router.push({ pathname: "/chat", params: { id: conversation.id } })}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <View style={[styles.dot, { backgroundColor: dot?.color ?? colors.border }]} />
            <View style={styles.rowText}>
              <Text numberOfLines={2} style={styles.rowTitle}>
                {conversation.title}
              </Text>
              <Text style={styles.meta}>{meta}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 4 },
  title: { ...eyebrow, paddingBottom: 6 },
  error: { color: colors.danger, paddingBottom: 6 },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    minHeight: 56,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  pressed: { opacity: 0.7 },
  dot: { width: 9, height: 9, marginTop: 6, borderRadius: 5 },
  rowText: { flex: 1, gap: 3 },
  rowTitle: { fontSize: 15, lineHeight: 20 },
  meta: { color: colors.textMuted, fontSize: 12.5 },
});
