import { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import TextInput from "../ui/TextInput";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import type { PersistedRulingResponse, QuestionInterpretResponse } from "@mtg-rules/contracts";
import { useAuth } from "../auth/AuthProvider";
import Loader from "../ui/Loader";
import Text from "../ui/Text";
import { colors, fonts } from "../theme";
import {
  askJudge,
  emptyGameState,
  fetchConversation,
  interpretFollowUp,
  type ChatGameState,
} from "./api";
import { QuestionRequestError } from "../questions/question-error-message";
import { discardDraft, getDraft } from "./draft-store";
import JudgeMessage, { outcomeLabel } from "./JudgeMessage";
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
  /** Set once the question was interpreted; a retry without it interprets again. */
  gameState?: ChatGameState;
  unmatched?: string[];
}

interface RulingInput {
  question: string;
  cards: ChatCard[];
  gameState: ChatGameState;
  priorRulingIds: string[];
  conversationId?: string;
}

let turnCounter = 0;
const nextKey = () => `turn-${(turnCounter += 1)}`;

const loadingLines = ["Consulting the rulebook…", "Checking the stack…", "Weighing the evidence…"];

function announce(message: string) {
  // Live regions only reach Android screen readers; this also covers VoiceOver.
  AccessibilityInfo.announceForAccessibility(message);
}

export default function ChatScreen({
  draftId,
  conversationId: initialConversationId,
}: {
  draftId?: string;
  conversationId?: string;
}) {
  const { session, loading: authLoading } = useAuth();
  const accessToken = session?.access_token;
  const insets = useSafeAreaInsets();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [loadError, setLoadError] = useState("");
  const [loadingConversation, setLoadingConversation] = useState(Boolean(initialConversationId));
  const [input, setInput] = useState("");
  const scrollRef = useRef<ScrollView>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const started = useRef(false);

  const busy = turns.some((turn) => turn.status === "thinking" || turn.status === "choosing");

  const updateTurn = useCallback((key: string, patch: Partial<Turn>) => {
    if (!mounted.current) return;
    setTurns((current) => current.map((turn) => (turn.key === key ? { ...turn, ...patch } : turn)));
  }, []);

  /** One request at a time: each send, pick, or retry owns the controller until it ends. */
  const beginRequest = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    return controller;
  }, []);

  const fail = useCallback(
    (key: string, error: unknown, fallback: string) => {
      // Only messages written for players are shown; parser or runtime errors use the fallback.
      const note = error instanceof QuestionRequestError ? error.message : fallback;
      updateTurn(key, { status: "failed", note });
      announce(note);
    },
    [updateTurn],
  );

  const runRuling = useCallback(
    async (key: string, request: RulingInput, controller: AbortController) => {
      updateTurn(key, { status: "thinking", note: undefined, cards: request.cards });
      try {
        const ruling = await askJudge(request, accessToken, controller.signal);
        if (controller.signal.aborted || !mounted.current) return;
        if (ruling.conversationId) setConversationId(ruling.conversationId);
        updateTurn(key, { status: "answered", ruling });
        announce(`${outcomeLabel(ruling.ruling.outcome)}. ${ruling.ruling.summary}`);
      } catch (error) {
        // Leaving the screen aborts quietly; anything else ends the turn so the chat never
        // stays stuck on "thinking".
        if (!mounted.current) return;
        fail(
          key,
          controller.signal.aborted ? new QuestionRequestError("Stopped.") : error,
          "The judge could not answer.",
        );
      }
    },
    [accessToken, fail, updateTurn],
  );

  /** Interprets a follow-up, resolves its cards, then asks for the ruling. */
  const processFollowUp = useCallback(
    async (key: string, question: string, carriedCards: ChatCard[], priorRulingIds: string[]) => {
      const controller = beginRequest();
      updateTurn(key, { status: "thinking", note: undefined });
      try {
        const interpretation = await interpretFollowUp(question, priorRulingIds, controller.signal);
        if (controller.signal.aborted || !mounted.current) return;
        if (!interpretation.inScope) {
          updateTurn(key, { status: "out_of_scope", note: interpretation.scopeReason });
          announce(`Outside what the judge can rule on. ${interpretation.scopeReason}`);
          return;
        }
        const gameState: ChatGameState = {
          events: interpretation.events,
          knownFacts: interpretation.knownFacts,
          missingFacts: interpretation.missingFacts,
          searchTerms: interpretation.searchTerms,
        };
        const resolution = resolveMentions(interpretation.cardMentions, carriedCards);
        const cards = mergeCards(carriedCards, resolution.resolved);
        if (resolution.ambiguous.length > 0) {
          updateTurn(key, {
            status: "choosing",
            pendingMentions: resolution.ambiguous,
            pendingCards: cards,
            gameState,
            unmatched: resolution.unmatched,
          });
          announce(`Which card do you mean by ${resolution.ambiguous[0]?.text ?? "that name"}?`);
          return;
        }
        updateTurn(key, { gameState, unmatched: resolution.unmatched });
        await runRuling(
          key,
          { question, cards, gameState, priorRulingIds, conversationId },
          controller,
        );
      } catch (error) {
        if (!mounted.current) return;
        fail(
          key,
          controller.signal.aborted ? new QuestionRequestError("Stopped.") : error,
          "The judge could not read that.",
        );
      }
    },
    [beginRequest, conversationId, fail, runRuling, updateTurn],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abortRef.current?.abort();
    };
  }, []);

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
      void runRuling(key, { ...draft, priorRulingIds: [] }, beginRequest()).finally(() =>
        discardDraft(draftId),
      );
      return;
    }
    if (!initialConversationId || authLoading) return;
    if (!accessToken) {
      setLoadingConversation(false);
      setLoadError("Sign in to open your saved chats.");
      return;
    }
    started.current = true;
    setLoadError("");
    setLoadingConversation(true);
    void fetchConversation(accessToken, initialConversationId)
      .then((conversation) => {
        if (!mounted.current) return;
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
      .catch((error: unknown) => {
        if (mounted.current)
          setLoadError(
            error instanceof QuestionRequestError ? error.message : "Could not open this chat.",
          );
      })
      .finally(() => {
        if (mounted.current) setLoadingConversation(false);
      });
  }, [accessToken, authLoading, beginRequest, draftId, initialConversationId, runRuling]);

  const cardsBefore = (index: number) =>
    [...turns.slice(0, index)].reverse().find((turn) => turn.cards.length > 0)?.cards ?? [];
  const rulingIdsBefore = (index: number) =>
    contextRulingIds(turns.slice(0, index).map((turn) => turn.ruling));

  function sendFollowUp() {
    const question = input.trim();
    if (!question || busy || loadError) return;
    setInput("");
    const key = nextKey();
    const carriedCards = cardsBefore(turns.length);
    const priorRulingIds = rulingIdsBefore(turns.length);
    setTurns((current) => [...current, { key, question, cards: carriedCards, status: "thinking" }]);
    void processFollowUp(key, question, carriedCards, priorRulingIds);
  }

  function chooseCard(turn: Turn, mention: Mention, choice: Mention["candidates"][number]) {
    const remaining = (turn.pendingMentions ?? []).filter((item) => item !== mention);
    const cards = mergeCards(turn.pendingCards ?? turn.cards, [toChatCard(choice)]);
    if (remaining.length > 0) {
      updateTurn(turn.key, { pendingMentions: remaining, pendingCards: cards });
      return;
    }
    updateTurn(turn.key, { pendingMentions: undefined, pendingCards: undefined });
    const index = turns.findIndex((item) => item.key === turn.key);
    void runRuling(
      turn.key,
      {
        question: turn.question,
        cards,
        gameState: turn.gameState ?? emptyGameState,
        priorRulingIds: rulingIdsBefore(index),
        conversationId,
      },
      beginRequest(),
    );
  }

  /** Retries a failed turn, or asks again on an answered one (the old answer is replaced). */
  function rerun(turn: Turn) {
    if (busy) return;
    const index = turns.findIndex((item) => item.key === turn.key);
    // A follow-up that failed before it was interpreted has to be interpreted again, or
    // cards named in it would be lost.
    if (!turn.gameState && !turn.ruling && index > 0) {
      void processFollowUp(turn.key, turn.question, cardsBefore(index), rulingIdsBefore(index));
      return;
    }
    void runRuling(
      turn.key,
      {
        question: turn.question,
        cards: turn.cards,
        gameState: turn.gameState ?? emptyGameState,
        priorRulingIds: rulingIdsBefore(index),
        conversationId,
      },
      beginRequest(),
    );
  }

  const lastAnsweredKey = [...turns].reverse().find((turn) => turn.status === "answered")?.key;

  return (
    <SafeAreaView edges={["bottom", "left", "right"]} style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        // The stack header sits above this view on iOS: status bar plus the 44pt bar.
        keyboardVerticalOffset={Platform.OS === "ios" ? insets.top + 44 : 0}
        style={styles.flex}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.thread}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          {loadingConversation ? <Loader accessibilityLabel="Opening chat" size={14} /> : null}
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
                  <Loader accessibilityLabel="The judge is thinking" size={10} />
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
                <JudgeMessage
                  result={turn.ruling}
                  onAskAgain={turn.key === lastAnsweredKey && !busy ? () => rerun(turn) : undefined}
                />
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
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ disabled: busy }}
                    disabled={busy}
                    onPress={() => rerun(turn)}
                  >
                    <Text style={[styles.link, busy && styles.disabledLink]}>Try again</Text>
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
            onPress={sendFollowUp}
            style={[styles.send, (busy || !input.trim()) && styles.sendDisabled]}
          >
            <Ionicons name="arrow-up" size={20} color={colors.accentInk} />
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
    backgroundColor: colors.surfaceRaised,
  },
  userText: { color: colors.text, fontSize: 16, lineHeight: 22 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.neutralSurface,
  },
  chipText: { color: colors.textSoft, fontSize: 12, fontWeight: "600" },
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
  thinkingText: { color: colors.textMuted, fontFamily: fonts.displayItalic, fontSize: 16 },
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
    borderColor: colors.accent,
    borderRadius: 20,
  },
  choiceText: { color: colors.accent, fontWeight: "600" },
  notice: { gap: 8, padding: 14, borderRadius: 12, backgroundColor: colors.surface },
  noticeText: { color: colors.text },
  link: { color: colors.accent, textDecorationLine: "underline" },
  disabledLink: { opacity: 0.4 },
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
    backgroundColor: colors.accent,
  },
  sendDisabled: { opacity: 0.4 },
});
