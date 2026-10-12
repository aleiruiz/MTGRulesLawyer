import { useCallback, useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import type { PersistedRulingResponse, QuestionInterpretResponse } from "@mtg-rules/contracts";
import { useAuth } from "../auth/AuthProvider";
import GrimoireBackdrop from "../ui/GrimoireBackdrop";
import ManaLoader from "../ui/ManaLoader";
import Text from "../ui/Text";
import { colors, fonts } from "../theme";
import {
  askJudge,
  emptyGameState,
  fetchConversation,
  interpretFollowUp,
  type ChatGameState,
} from "./api";
import { discardDraft, getDraft } from "./draft-store";
import JudgeMessage from "./JudgeMessage";
import { contextRulingIds, mergeCards, resolveMentions, toChatCard, type ChatCard } from "./turns";

type Mention = QuestionInterpretResponse["cardMentions"][number];

interface Turn {
  key: string;
  question: string;
  cards: ChatCard[];
  status: "thinking" | "choosing" | "answered" | "out_of_scope" | "failed";
  ruling?: PersistedRulingResponse;
  /** The judge's note when it could not answer (scope, error). */
  note?: string;
  /** Mentions with several matching cards, waiting for the player's pick. */
  pendingMentions?: Mention[];
  /** Cards resolved so far while the player picks the rest. */
  pendingCards?: ChatCard[];
  gameState?: ChatGameState;
  unmatched?: string[];
}

let turnCounter = 0;
const nextKey = () => `turn-${(turnCounter += 1)}`;

const loadingLines = ["Consulting the rulebook…", "Checking the stack…", "Weighing the evidence…"];

export default function ChatScreen({
  draftId,
  conversationId: initialConversationId,
}: {
  draftId?: string;
  conversationId?: string;
}) {
  const { session } = useAuth();
  const accessToken = session?.access_token;
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [loadError, setLoadError] = useState("");
  const [loadingConversation, setLoadingConversation] = useState(Boolean(initialConversationId));
  const [input, setInput] = useState("");
  const scrollRef = useRef<ScrollView>(null);
  const abortRef = useRef<AbortController | null>(null);
  const started = useRef(false);

  const busy = turns.some((turn) => turn.status === "thinking" || turn.status === "choosing");

  const updateTurn = useCallback((key: string, patch: Partial<Turn>) => {
    setTurns((current) => current.map((turn) => (turn.key === key ? { ...turn, ...patch } : turn)));
  }, []);

  const runRuling = useCallback(
    async (
      key: string,
      request: {
        question: string;
        cards: ChatCard[];
        gameState: ChatGameState;
        priorRulingIds: string[];
        conversationId?: string;
      },
    ) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      updateTurn(key, { status: "thinking", note: undefined, cards: request.cards });
      try {
        const ruling = await askJudge(request, accessToken, controller.signal);
        if (ruling.conversationId) setConversationId(ruling.conversationId);
        updateTurn(key, { status: "answered", ruling });
      } catch (error) {
        if (controller.signal.aborted) return;
        updateTurn(key, {
          status: "failed",
          note: error instanceof Error ? error.message : "The judge could not answer.",
        });
      }
    },
    [accessToken, updateTurn],
  );

  // Start a new chat from the home screen's draft, or reopen a saved one.
  useEffect(() => {
    if (started.current) return;
    if (!draftId && !initialConversationId) {
      setLoadError("Start a new question from the home screen.");
      return;
    }
    if (draftId) {
      const draft = getDraft(draftId);
      if (!draft) {
        setLoadError("This question is no longer available. Ask it again from the home screen.");
        return;
      }
      started.current = true;
      const key = nextKey();
      setTurns([{ key, status: "thinking", ...draft }]);
      void runRuling(key, { ...draft, priorRulingIds: [] }).finally(() => discardDraft(draftId));
      return;
    }
    if (initialConversationId && accessToken) {
      started.current = true;
      void fetchConversation(accessToken, initialConversationId)
        .then((conversation) => {
          setTurns(
            conversation.turns.map((turn) => ({
              key: nextKey(),
              question: turn.ruling.question,
              cards: turn.cards,
              status: "answered" as const,
              ruling: turn.ruling,
            })),
          );
        })
        .catch((error: unknown) =>
          setLoadError(error instanceof Error ? error.message : "Could not open this chat."),
        )
        .finally(() => setLoadingConversation(false));
    } else if (initialConversationId) {
      setLoadingConversation(false);
      setLoadError("Sign in to open your saved chats.");
    }
  }, [accessToken, draftId, initialConversationId, runRuling]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const currentCards = [...turns].reverse().find((turn) => turn.cards.length > 0)?.cards ?? [];
  const priorRulingIds = contextRulingIds(turns.map((turn) => turn.ruling));

  async function sendFollowUp() {
    const question = input.trim();
    if (!question || busy) return;
    setInput("");
    const key = nextKey();
    const carriedCards = currentCards;
    setTurns((current) => [...current, { key, question, cards: carriedCards, status: "thinking" }]);
    try {
      const interpretation = await interpretFollowUp(question, priorRulingIds);
      if (!interpretation.inScope) {
        updateTurn(key, { status: "out_of_scope", note: interpretation.scopeReason });
        return;
      }
      const gameState: ChatGameState = {
        events: interpretation.events,
        knownFacts: interpretation.knownFacts,
        missingFacts: interpretation.missingFacts,
        searchTerms: interpretation.searchTerms,
      };
      const resolution = resolveMentions(interpretation.cardMentions);
      const cards = mergeCards(carriedCards, resolution.resolved);
      if (resolution.ambiguous.length > 0) {
        updateTurn(key, {
          status: "choosing",
          pendingMentions: resolution.ambiguous,
          pendingCards: cards,
          gameState,
          unmatched: resolution.unmatched,
        });
        return;
      }
      updateTurn(key, { unmatched: resolution.unmatched });
      await runRuling(key, { question, cards, gameState, priorRulingIds, conversationId });
    } catch (error) {
      updateTurn(key, {
        status: "failed",
        note: error instanceof Error ? error.message : "The judge could not read that.",
      });
    }
  }

  function chooseCard(turn: Turn, mention: Mention, choice: Mention["candidates"][number]) {
    const remaining = (turn.pendingMentions ?? []).filter((item) => item !== mention);
    const cards = mergeCards(turn.pendingCards ?? turn.cards, [toChatCard(choice)]);
    if (remaining.length > 0) {
      updateTurn(turn.key, { pendingMentions: remaining, pendingCards: cards });
      return;
    }
    updateTurn(turn.key, { pendingMentions: undefined, pendingCards: undefined });
    const earlierRulings = turns
      .slice(
        0,
        turns.findIndex((item) => item.key === turn.key),
      )
      .map((item) => item.ruling);
    void runRuling(turn.key, {
      question: turn.question,
      cards,
      gameState: turn.gameState ?? emptyGameState,
      priorRulingIds: contextRulingIds(earlierRulings),
      conversationId,
    });
  }

  function retry(turn: Turn) {
    const index = turns.findIndex((item) => item.key === turn.key);
    const earlierRulings = turns.slice(0, index).map((item) => item.ruling);
    void runRuling(turn.key, {
      question: turn.question,
      cards: turn.cards,
      gameState: turn.gameState ?? emptyGameState,
      priorRulingIds: contextRulingIds(earlierRulings),
      conversationId,
    });
  }

  return (
    <SafeAreaView edges={["bottom", "left", "right"]} style={styles.safeArea}>
      <GrimoireBackdrop />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
        style={styles.flex}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.thread}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          {loadingConversation ? <ManaLoader accessibilityLabel="Opening chat" size={14} /> : null}
          {loadError ? (
            <View style={styles.notice}>
              <Text accessibilityRole="alert" style={styles.noticeText}>
                {loadError}
              </Text>
              <Pressable accessibilityRole="button" onPress={() => router.replace("/")}>
                <Text style={styles.link}>Back to the home screen</Text>
              </Pressable>
            </View>
          ) : null}

          {turns.map((turn, index) => (
            <View key={turn.key} style={styles.turn}>
              <View style={styles.userBubble}>
                <Text selectable style={styles.userText}>
                  {turn.question}
                </Text>
                {turn.cards.length > 0 &&
                (index === 0 ||
                  turn.cards.map((card) => card.oracleId).join() !==
                    turns[index - 1]?.cards.map((card) => card.oracleId).join()) ? (
                  <View style={styles.chips} accessibilityLabel="Cards in this question">
                    {turn.cards.map((card) => (
                      <View key={card.oracleId} style={styles.chip}>
                        <Text style={styles.chipText}>
                          {card.name}
                          {card.quantity > 1 ? ` ×${card.quantity}` : ""}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>

              {turn.unmatched && turn.unmatched.length > 0 ? (
                <Text style={styles.aside}>
                  No card found for {turn.unmatched.map((name) => `“${name}”`).join(", ")}; the
                  judge treats it as plain text.
                </Text>
              ) : null}

              {turn.status === "thinking" ? (
                <View style={styles.thinking}>
                  <ManaLoader accessibilityLabel="The judge is thinking" size={10} />
                  <Text style={styles.thinkingText}>
                    {loadingLines[index % loadingLines.length]}
                  </Text>
                </View>
              ) : null}

              {turn.status === "choosing" && turn.pendingMentions ? (
                <View style={styles.judgeNote}>
                  {turn.pendingMentions.map((mention) => (
                    <View key={`${mention.start}-${mention.end}`} style={styles.choiceGroup}>
                      <Text style={styles.noteText}>Which “{mention.text}” do you mean?</Text>
                      <View style={styles.chips}>
                        {mention.candidates.map((candidate) => (
                          <Pressable
                            key={candidate.oracleId}
                            accessibilityRole="button"
                            accessibilityLabel={`Use ${candidate.name} for ${mention.text}`}
                            onPress={() => chooseCard(turn, mention, candidate)}
                            style={styles.choice}
                          >
                            <Text style={styles.choiceText}>{candidate.name}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}

              {turn.status === "answered" && turn.ruling ? (
                <JudgeMessage result={turn.ruling} />
              ) : null}

              {turn.status === "out_of_scope" ? (
                <View style={styles.judgeNote}>
                  <Text style={styles.noteText}>
                    That one is outside what I can rule on. {turn.note}
                  </Text>
                </View>
              ) : null}

              {turn.status === "failed" ? (
                <View style={styles.judgeNote}>
                  <Text accessibilityRole="alert" style={styles.errorText}>
                    {turn.note}
                  </Text>
                  <Pressable accessibilityRole="button" onPress={() => retry(turn)}>
                    <Text style={styles.link}>Try again</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ))}

          {!session && turns.some((turn) => turn.ruling) ? (
            <Text style={styles.aside}>
              Sign in from the account icon to keep your last 10 chats.
            </Text>
          ) : null}
        </ScrollView>

        <View style={styles.composer}>
          <TextInput
            accessibilityLabel="Follow-up question"
            editable={!loadError}
            multiline
            maxLength={4_000}
            onChangeText={setInput}
            placeholder={busy ? "The judge is answering…" : "Ask a follow-up…"}
            placeholderTextColor={colors.textSubtle}
            style={styles.input}
            value={input}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send follow-up"
            disabled={busy || !input.trim() || Boolean(loadError)}
            onPress={() => void sendFollowUp()}
            style={[styles.send, (busy || !input.trim()) && styles.sendDisabled]}
          >
            <Ionicons name="arrow-up" size={20} color={colors.ink} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  thread: {
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    gap: 18,
    padding: 16,
    paddingBottom: 24,
  },
  turn: { gap: 10 },
  userBubble: {
    alignSelf: "flex-end",
    maxWidth: "88%",
    gap: 8,
    padding: 12,
    borderRadius: 16,
    borderTopRightRadius: 4,
    backgroundColor: colors.parchment,
  },
  userText: { color: colors.ink, fontSize: 16, lineHeight: 22 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: colors.goldDeep,
    borderRadius: 10,
    backgroundColor: "rgba(201, 162, 74, 0.18)",
  },
  chipText: { color: colors.ink, fontSize: 12, fontWeight: "600" },
  aside: { color: colors.textMuted, fontSize: 13, textAlign: "center" },
  thinking: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    borderTopLeftRadius: 4,
    backgroundColor: colors.surface,
  },
  thinkingText: { color: colors.textMuted, fontFamily: fonts.serifItalic, fontSize: 16 },
  judgeNote: {
    alignSelf: "flex-start",
    maxWidth: "92%",
    gap: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    borderTopLeftRadius: 4,
    backgroundColor: colors.surface,
  },
  noteText: { fontSize: 15, lineHeight: 21 },
  errorText: { color: colors.danger, fontWeight: "600" },
  choiceGroup: { gap: 8 },
  choice: {
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.gold,
    borderRadius: 20,
  },
  choiceText: { color: colors.goldBright, fontWeight: "600" },
  notice: { gap: 8, padding: 14, borderRadius: 12, backgroundColor: colors.surface },
  noticeText: { color: colors.text },
  link: { color: colors.goldBright, textDecorationLine: "underline" },
  composer: {
    width: "100%",
    maxWidth: 792,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.backgroundDeep,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 140,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 16,
  },
  send: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
    backgroundColor: colors.gold,
  },
  sendDisabled: { opacity: 0.4 },
});
