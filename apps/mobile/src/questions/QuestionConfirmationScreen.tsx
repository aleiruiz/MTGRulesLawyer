import { colors, fonts } from "../theme";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import Text from "../ui/Text";
import { SafeAreaView } from "react-native-safe-area-context";
import logo from "../../assets/logo.png";
import AccountButton from "../ui/AccountButton";
import GrimoireBackdrop from "../ui/GrimoireBackdrop";
import ManaLoader from "../ui/ManaLoader";
import { router } from "expo-router";
import { saveDraft } from "../chat/draft-store";
import RecentConversations from "../chat/RecentConversations";
import ConfirmedCardTile from "./ConfirmedCardTile";
import { apiUrl } from "../api-url";
import {
  cardLookupResponseSchema,
  MAX_CONFIRMED_CARDS,
  questionInterpretRequestSchema,
  questionInterpretResponseSchema,
  type CardLookupResponse,
  type QuestionInterpretResponse,
} from "@mtg-rules/contracts";

type Card = CardLookupResponse["cards"][number];
type Mention = QuestionInterpretResponse["cardMentions"][number];
type SearchMode =
  | { type: "add" }
  | { type: "resolve"; mentionIndex: number }
  | { type: "replace"; oracleId: string; mentionIndexes: number[] };
interface DisplayCard {
  card: Card;
  mentionIndexes: number[];
}

function highlightedQuestion(question: string, mentions: Mention[], ignored: Set<number>) {
  const spans = mentions
    .map((mention, index) => ({ ...mention, index }))
    .filter((mention) => !ignored.has(mention.index))
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const mention of spans) {
    if (mention.start < cursor || mention.end > question.length) continue;
    if (mention.start > cursor) {
      nodes.push(question.slice(cursor, mention.start));
    }
    nodes.push(
      <Text key={`mention-${mention.index}`} style={styles.highlight}>
        {question.slice(mention.start, mention.end)}
      </Text>,
    );
    cursor = mention.end;
  }
  if (cursor < question.length) nodes.push(question.slice(cursor));
  return nodes;
}

export default function QuestionConfirmationScreen() {
  const interpretationRequestId = useRef(0);
  const searchRequestId = useRef(0);
  const interpretationAbortController = useRef<AbortController | null>(null);
  const [question, setQuestion] = useState("");
  const [interpretation, setInterpretation] = useState<QuestionInterpretResponse | null>(null);
  const [selectedByMention, setSelectedByMention] = useState<Record<number, string>>({});
  const [ignoredMentions, setIgnoredMentions] = useState<number[]>([]);
  const [manualCards, setManualCards] = useState<Card[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [faceIndexes, setFaceIndexes] = useState<Record<string, number>>({});
  const [isInterpreting, setIsInterpreting] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode | null>(null);
  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState<Card[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  useEffect(
    () => () => {
      interpretationAbortController.current?.abort();
    },
    [],
  );

  function askTheJudge() {
    const draftId = saveDraft({
      question,
      gameState: {
        events: interpretation?.events ?? [],
        knownFacts: interpretation?.knownFacts ?? [],
        missingFacts: interpretation?.missingFacts ?? [],
        searchTerms: interpretation?.searchTerms ?? [],
      },
      cards: displayCards.map(({ card }) => ({
        oracleId: card.oracleId,
        name: card.name,
        faceIndex: faceIndexes[card.oracleId] ?? card.matchedFace.faceIndex,
        quantity: counts[card.oracleId] ?? 1,
      })),
    });
    router.push({ pathname: "/chat", params: { draft: draftId } });
  }

  const ignoredSet = useMemo(() => new Set(ignoredMentions), [ignoredMentions]);
  const displayCards = useMemo(() => {
    const cards = new Map<string, DisplayCard>();
    interpretation?.cardMentions.forEach((mention, mentionIndex) => {
      const selectedId = selectedByMention[mentionIndex];
      if (!selectedId || ignoredSet.has(mentionIndex)) return;
      const card =
        mention.candidates.find((candidate) => candidate.oracleId === selectedId) ??
        manualCards.find((candidate) => candidate.oracleId === selectedId);
      if (!card) return;
      const existing = cards.get(selectedId);
      if (existing) existing.mentionIndexes.push(mentionIndex);
      else cards.set(selectedId, { card, mentionIndexes: [mentionIndex] });
    });
    for (const card of manualCards) {
      const existing = cards.get(card.oracleId);
      if (!existing) cards.set(card.oracleId, { card, mentionIndexes: [] });
    }
    return [...cards.values()];
  }, [ignoredSet, interpretation, manualCards, selectedByMention]);

  const unresolvedMentionIndexes = useMemo(() => {
    if (!interpretation) return [];
    return interpretation.cardMentions.flatMap((mention, index) =>
      !ignoredSet.has(index) && !selectedByMention[index] ? [index] : [],
    );
  }, [ignoredSet, interpretation, selectedByMention]);

  async function submitQuestion() {
    const requestId = ++interpretationRequestId.current;
    interpretationAbortController.current?.abort();
    const abortController = new AbortController();
    interpretationAbortController.current = abortController;
    setIsInterpreting(true);
    setRequestError("");
    setInterpretation(null);
    setSelectedByMention({});
    setIgnoredMentions([]);
    setManualCards([]);
    setCounts({});
    setFaceIndexes({});
    setSearchMode(null);
    setSearchResults([]);
    try {
      const submittedQuestion = questionInterpretRequestSchema.parse({ question }).question;
      setQuestion(submittedQuestion);
      const response = await fetch(`${apiUrl}/api/questions/interpret`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: submittedQuestion }),
        signal: abortController.signal,
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const errorBody = typeof body === "object" && body !== null ? body : {};
        const errorCode =
          "error" in errorBody && typeof errorBody.error === "string" ? errorBody.error : undefined;
        const retryAfter =
          "retryAfterSeconds" in errorBody && typeof errorBody.retryAfterSeconds === "number"
            ? errorBody.retryAfterSeconds
            : undefined;
        const wait = retryAfter === undefined ? "" : ` Try again in ${retryAfter}s.`;
        throw new Error(
          errorCode
            ? `${errorCode.replaceAll("_", " ")}.${wait}`
            : `Question request failed (${response.status}).`,
        );
      }
      const result = questionInterpretResponseSchema.parse(body);
      if (requestId !== interpretationRequestId.current) return;
      setInterpretation(result);
      setSelectedByMention(
        Object.fromEntries(
          result.cardMentions.flatMap((mention, index) =>
            // A near match (typo, partial name) is a guess; the player confirms it.
            mention.candidates.length === 1 && mention.candidates[0]?.matchKind !== "approximate"
              ? [[index, mention.candidates[0]?.oracleId ?? ""]]
              : [],
          ),
        ),
      );
    } catch (error) {
      if (requestId === interpretationRequestId.current && !abortController.signal.aborted) {
        setRequestError(
          error instanceof Error ? error.message : "Unable to interpret the question.",
        );
      }
    } finally {
      if (requestId === interpretationRequestId.current) {
        interpretationAbortController.current = null;
        setIsInterpreting(false);
      }
    }
  }

  function openCardSearch(mode: SearchMode, initialText = "") {
    searchRequestId.current += 1;
    setIsSearching(false);
    setSearchMode(mode);
    setSearchText(initialText);
    setSearchResults([]);
    setSearchError("");
  }

  async function searchCards() {
    const name = searchText.trim();
    if (!name) return;
    const requestId = ++searchRequestId.current;
    setIsSearching(true);
    setSearchError("");
    try {
      const response = await fetch(`${apiUrl}/api/cards/lookup?name=${encodeURIComponent(name)}`);
      const result: unknown = await response.json();
      if (!response.ok)
        throw new Error("Card search failed. Check the API connection and try again.");
      const cards = cardLookupResponseSchema.parse(result).cards;
      if (requestId !== searchRequestId.current) return;
      setSearchResults(cards);
      if (cards.length === 0) {
        setSearchError("No card found with that name. Check the spelling or try part of the name.");
      }
    } catch (error) {
      if (requestId === searchRequestId.current) {
        setSearchError(error instanceof Error ? error.message : "Card search failed.");
      }
    } finally {
      if (requestId === searchRequestId.current) setIsSearching(false);
    }
  }

  function selectSearchResult(card: Card) {
    if (!searchMode) return;
    if (
      searchMode.type === "add" &&
      displayCards.length >= MAX_CONFIRMED_CARDS &&
      !displayCards.some((entry) => entry.card.oracleId === card.oracleId)
    ) {
      setSearchError(`Evidence supports up to ${MAX_CONFIRMED_CARDS} distinct cards.`);
      return;
    }
    searchRequestId.current += 1;
    setIsSearching(false);
    if (searchMode.type === "add") {
      setManualCards((current) =>
        current.some((existing) => existing.oracleId === card.oracleId)
          ? current
          : [...current, card],
      );
    } else if (searchMode.type === "resolve") {
      setSelectedByMention((current) => ({ ...current, [searchMode.mentionIndex]: card.oracleId }));
      setIgnoredMentions((current) => current.filter((index) => index !== searchMode.mentionIndex));
      setManualCards((current) =>
        current.some((existing) => existing.oracleId === card.oracleId)
          ? current
          : [...current, card],
      );
    } else {
      setManualCards((current) => [
        ...current.filter(
          (existing) =>
            existing.oracleId !== searchMode.oracleId && existing.oracleId !== card.oracleId,
        ),
        card,
      ]);
      if (searchMode.mentionIndexes.length > 0) {
        setSelectedByMention((current) => {
          const next = { ...current };
          for (const index of searchMode.mentionIndexes) next[index] = card.oracleId;
          return next;
        });
      } else {
        setManualCards((current) => [
          ...current.filter((existing) => existing.oracleId !== searchMode.oracleId),
          card,
        ]);
      }
    }
    setSearchMode(null);
    setSearchResults([]);
    setSearchText("");
  }

  function removeCard(entry: DisplayCard) {
    setSelectedByMention((current) => {
      const next = { ...current };
      for (const index of entry.mentionIndexes) delete next[index];
      return next;
    });
    setIgnoredMentions((current) => [...new Set([...current, ...entry.mentionIndexes])]);
    setManualCards((current) => current.filter((card) => card.oracleId !== entry.card.oracleId));
  }

  function adjustCount(oracleId: string, delta: number) {
    setCounts((current) => ({
      ...current,
      [oracleId]: Math.max(1, (current[oracleId] ?? 1) + delta),
    }));
  }

  function cycleFace(card: Card) {
    setFaceIndexes((current) => ({
      ...current,
      [card.oracleId]:
        (card.faces.findIndex(
          (face) => face.faceIndex === (current[card.oracleId] ?? card.matchedFace.faceIndex),
        ) +
          1) %
        card.faces.length,
    }));
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <GrimoireBackdrop />
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <View style={styles.brand}>
            <Image accessible={false} source={logo} style={styles.logo} />
            <Text accessibilityRole="header" style={styles.title}>
              Rules Lawyer
            </Text>
          </View>
          <AccountButton />
        </View>
        <Text style={styles.subtitle}>Unofficial Magic rules research assistant</Text>
        <View style={styles.divider} />
        <Text style={styles.sectionTitle}>Describe the game situation</Text>
        <TextInput
          placeholderTextColor={colors.inkMuted}
          accessibilityLabel="Magic rules question"
          accessibilityHint="Enter up to 4000 characters about a Magic game interaction."
          editable={!isInterpreting}
          multiline
          maxLength={4_000}
          onChangeText={(value) => {
            setQuestion(value);
            setInterpretation(null);
            setSelectedByMention({});
            setIgnoredMentions([]);
            setManualCards([]);
            setCounts({});
            setFaceIndexes({});
          }}
          placeholder="For example: If my Lightning Bolt target leaves, what happens?"
          style={styles.questionInput}
          textAlignVertical="top"
          value={question}
        />
        <Text style={styles.helperText}>{question.length}/4000 characters</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Interpret question"
          disabled={isInterpreting || question.trim().length === 0}
          onPress={() => void submitQuestion()}
          style={({ pressed }) => [
            styles.primaryButton,
            (isInterpreting || question.trim().length === 0) && styles.disabledButton,
            pressed && styles.pressedButton,
          ]}
        >
          {isInterpreting ? (
            <ManaLoader accessibilityLabel="Reading the question" size={11} />
          ) : (
            <Text style={styles.primaryButtonText}>Find cards and game facts</Text>
          )}
        </Pressable>
        {requestError ? (
          <Text accessibilityRole="alert" style={styles.errorText}>
            {requestError}
          </Text>
        ) : null}
        {!interpretation ? <RecentConversations /> : null}

        {interpretation ? (
          <View style={styles.results}>
            <View
              style={[styles.scopeBox, interpretation.inScope ? styles.scopeIn : styles.scopeOut]}
            >
              <Text style={styles.scopeTitle}>
                {interpretation.inScope ? "Magic rules question" : "Outside the app’s scope"}
              </Text>
              <Text>{interpretation.scopeReason}</Text>
            </View>

            {interpretation.inScope ? (
              <>
                <Text style={styles.sectionTitle}>Question with detected cards</Text>
                <Text
                  accessibilityLabel="Question with highlighted card mentions"
                  style={styles.questionPreview}
                >
                  {highlightedQuestion(question, interpretation.cardMentions, ignoredSet)}
                </Text>

                {interpretation.events.length ||
                interpretation.knownFacts.length ||
                interpretation.missingFacts.length ? (
                  <View style={styles.factsBox}>
                    <Text style={styles.cardTitle}>Scenario summary</Text>
                    {interpretation.events.length > 0 ? (
                      <Text>Events: {interpretation.events.join(" → ")}</Text>
                    ) : null}
                    {interpretation.knownFacts.length > 0 ? (
                      <Text>Known: {interpretation.knownFacts.join("; ")}</Text>
                    ) : null}
                    {interpretation.missingFacts.length > 0 ? (
                      <Text style={styles.missingText}>
                        Still unclear: {interpretation.missingFacts.join("; ")}
                      </Text>
                    ) : null}
                  </View>
                ) : null}

                {interpretation.cardMentions.map((mention, mentionIndex) => {
                  if (selectedByMention[mentionIndex] || ignoredSet.has(mentionIndex)) return null;
                  return (
                    <View key={`${mention.start}-${mention.end}`} style={styles.mentionBox}>
                      <Text style={styles.cardTitle}>
                        {mention.candidates[0]?.matchKind === "approximate"
                          ? `Did you mean one of these for “${mention.text}”?`
                          : `Choose a match for “${mention.text}”`}
                      </Text>
                      {mention.candidates.map((candidate) => (
                        <Pressable
                          key={candidate.oracleId}
                          accessibilityRole="button"
                          accessibilityLabel={`Select ${candidate.name} for ${mention.text}`}
                          onPress={() => {
                            setSelectedByMention((current) => ({
                              ...current,
                              [mentionIndex]: candidate.oracleId,
                            }));
                          }}
                          style={styles.choiceButton}
                        >
                          <Text style={styles.choiceText}>{candidate.name}</Text>
                        </Pressable>
                      ))}
                      {mention.candidates.length === 0 ? (
                        <Text style={styles.helperText}>
                          No matching card was found in the active Oracle data.
                        </Text>
                      ) : null}
                      <View style={styles.inlineButtons}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Find a different card for ${mention.text}`}
                          onPress={() =>
                            openCardSearch({ type: "resolve", mentionIndex }, mention.text)
                          }
                          style={styles.secondaryButton}
                        >
                          <Text style={styles.secondaryButtonText}>Find a card</Text>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Remove ${mention.text} as a card mention`}
                          onPress={() => {
                            setIgnoredMentions((current) => [
                              ...new Set([...current, mentionIndex]),
                            ]);
                          }}
                          style={styles.secondaryButton}
                        >
                          <Text style={styles.secondaryButtonText}>Remove mention</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })}

                <Text style={styles.sectionTitle}>Confirmed card choices</Text>
                {displayCards.length > 0 ? (
                  <ScrollView
                    accessibilityLabel="Swipeable confirmed card choices"
                    horizontal
                    showsHorizontalScrollIndicator
                    contentContainerStyle={styles.cardRow}
                  >
                    {displayCards.map((entry) => {
                      const { card } = entry;
                      const faceIndex = faceIndexes[card.oracleId] ?? card.matchedFace.faceIndex;
                      return (
                        <ConfirmedCardTile
                          key={card.oracleId}
                          card={card}
                          mentionCount={entry.mentionIndexes.length}
                          copyCount={counts[card.oracleId] ?? 1}
                          faceIndex={faceIndex}
                          onSwitchFace={() => cycleFace(card)}
                          onChangeCount={(delta) => adjustCount(card.oracleId, delta)}
                          onReplace={() =>
                            openCardSearch({
                              type: "replace",
                              oracleId: card.oracleId,
                              mentionIndexes: entry.mentionIndexes,
                            })
                          }
                          onRemove={() => removeCard(entry)}
                        />
                      );
                    })}
                  </ScrollView>
                ) : (
                  <Text style={styles.helperText}>
                    No cards selected yet. Add a card or remove any false-positive mentions.
                  </Text>
                )}

                {searchMode ? (
                  <View style={styles.searchPanel}>
                    <Text style={styles.cardTitle}>
                      {searchMode.type === "add"
                        ? "Add a missed card"
                        : searchMode.type === "resolve"
                          ? "Resolve card mention"
                          : "Replace card"}
                    </Text>
                    <View style={styles.searchRow}>
                      <TextInput
                        placeholderTextColor={colors.textSubtle}
                        accessibilityLabel="Card name"
                        onChangeText={(value) => {
                          searchRequestId.current += 1;
                          setIsSearching(false);
                          setSearchResults([]);
                          setSearchError("");
                          setSearchText(value);
                        }}
                        onSubmitEditing={() => void searchCards()}
                        placeholder="Card name (partial or misspelled is fine)"
                        returnKeyType="search"
                        style={styles.searchInput}
                        value={searchText}
                      />
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Search cards by name"
                        disabled={isSearching || !searchText.trim()}
                        onPress={() => void searchCards()}
                        style={[
                          styles.secondaryButton,
                          (isSearching || !searchText.trim()) && styles.disabledButton,
                        ]}
                      >
                        {isSearching ? (
                          <ActivityIndicator />
                        ) : (
                          <Text style={styles.secondaryButtonText}>Search</Text>
                        )}
                      </Pressable>
                    </View>
                    {searchError ? (
                      <Text accessibilityRole="alert" style={styles.helperText}>
                        {searchError}
                      </Text>
                    ) : null}
                    {searchResults.map((card) => (
                      <Pressable
                        key={card.oracleId}
                        accessibilityRole="button"
                        accessibilityLabel={`Choose ${card.name}, Oracle ID ${card.oracleId}`}
                        onPress={() => selectSearchResult(card)}
                        style={styles.choiceButton}
                      >
                        <Text style={styles.choiceText}>
                          {card.name} · {card.matchedFace.name}
                        </Text>
                      </Pressable>
                    ))}
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        searchRequestId.current += 1;
                        setIsSearching(false);
                        setSearchMode(null);
                      }}
                      style={styles.secondaryButton}
                    >
                      <Text style={styles.secondaryButtonText}>Close card search</Text>
                    </Pressable>
                  </View>
                ) : displayCards.length >= MAX_CONFIRMED_CARDS ? (
                  <Text style={styles.helperText}>
                    Evidence supports up to {MAX_CONFIRMED_CARDS} distinct cards. Remove one before
                    adding another.
                  </Text>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Add a missed card"
                    onPress={() => openCardSearch({ type: "add" })}
                    style={styles.secondaryButton}
                  >
                    <Text style={styles.secondaryButtonText}>Add a missed card</Text>
                  </Pressable>
                )}

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Ask the judge"
                  accessibilityHint="Opens a chat with the judge about this question and these cards."
                  disabled={unresolvedMentionIndexes.length > 0}
                  onPress={askTheJudge}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    unresolvedMentionIndexes.length > 0 && styles.disabledButton,
                    pressed && styles.pressedButton,
                  ]}
                >
                  <Text style={styles.primaryButtonText}>Ask the judge</Text>
                </Pressable>
                {unresolvedMentionIndexes.length > 0 ? (
                  <Text style={styles.helperText}>
                    Choose, find, or remove each of the {unresolvedMentionIndexes.length} unresolved
                    card mention{unresolvedMentionIndexes.length === 1 ? "" : "s"} to continue.
                  </Text>
                ) : null}
              </>
            ) : null}
          </View>
        ) : null}
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
    padding: 20,
    gap: 12,
    paddingBottom: 48,
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  brand: { flexShrink: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  logo: { width: 40, height: 40 },
  title: { flexShrink: 1, color: colors.goldBright, fontFamily: fonts.displayHeavy, fontSize: 28 },
  subtitle: { marginTop: -4, color: colors.textMuted, fontFamily: fonts.serif, fontSize: 18 },
  divider: { height: 1, marginVertical: 4, backgroundColor: colors.gold, opacity: 0.55 },
  sectionTitle: {
    marginTop: 12,
    color: colors.gold,
    fontFamily: fonts.display,
    fontSize: 14,
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  questionInput: {
    minHeight: 120,
    borderWidth: 2,
    borderColor: colors.gold,
    borderRadius: 12,
    padding: 14,
    backgroundColor: colors.parchment,
    color: colors.ink,
    fontSize: 16,
  },
  helperText: { color: colors.textMuted, fontSize: 13 },
  link: { color: colors.goldBright, fontSize: 15, textDecorationLine: "underline" },
  primaryButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: colors.gold,
  },
  primaryButtonText: {
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: 16,
    letterSpacing: 0.4,
    textAlign: "center",
  },
  secondaryButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.gold,
    borderRadius: 9,
    backgroundColor: colors.surface,
  },
  secondaryButtonText: {
    color: colors.goldBright,
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
  },
  pressedButton: { opacity: 0.75 },
  disabledButton: { opacity: 0.45 },
  errorText: { color: colors.danger, fontWeight: "600" },
  results: { gap: 12 },
  scopeBox: { padding: 14, borderRadius: 10, gap: 5 },
  scopeIn: { backgroundColor: colors.successSurface },
  scopeOut: { backgroundColor: colors.dangerSurface },
  scopeTitle: { color: colors.text, fontSize: 17, fontWeight: "700" },
  questionPreview: {
    padding: 14,
    borderRadius: 10,
    backgroundColor: colors.surface,
    fontSize: 16,
    lineHeight: 25,
  },
  highlight: {
    borderRadius: 4,
    backgroundColor: colors.goldBright,
    color: colors.ink,
    fontWeight: "800",
  },
  factsBox: { gap: 7, padding: 14, borderRadius: 10, backgroundColor: colors.surfaceRaised },
  missingText: { color: colors.warning, fontWeight: "600" },
  mentionBox: {
    gap: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.gold,
    borderRadius: 10,
    backgroundColor: colors.surfaceRaised,
  },
  cardRow: { gap: 12, paddingVertical: 4, paddingRight: 10 },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  inlineButtons: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  choiceButton: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  choiceText: { color: colors.text, fontWeight: "600" },
  searchPanel: {
    gap: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.surfaceRaised,
  },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  searchInput: {
    color: colors.text,
    flex: 1,
    minHeight: 46,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  confirmedBox: { gap: 8, padding: 14, borderRadius: 10, backgroundColor: colors.successSurface },
});
