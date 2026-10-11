import { useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import ConfirmedCardTile from "./ConfirmedCardTile";
import {
  cardLookupResponseSchema,
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

const localApiUrl = Platform.OS === "android" ? "http://10.0.2.2:3000" : "http://localhost:3000";
const apiUrl = process.env.EXPO_PUBLIC_API_URL || localApiUrl;

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
  const [question, setQuestion] = useState("");
  const [interpretation, setInterpretation] = useState<QuestionInterpretResponse | null>(null);
  const [selectedByMention, setSelectedByMention] = useState<Record<number, string>>({});
  const [ignoredMentions, setIgnoredMentions] = useState<number[]>([]);
  const [manualCards, setManualCards] = useState<Card[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [faceIndexes, setFaceIndexes] = useState<Record<string, number>>({});
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const [isInterpreting, setIsInterpreting] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode | null>(null);
  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState<Card[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [confirmed, setConfirmed] = useState(false);

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
    setConfirmed(false);
    try {
      const submittedQuestion = questionInterpretRequestSchema.parse({ question }).question;
      setQuestion(submittedQuestion);
      const response = await fetch(`${apiUrl}/api/questions/interpret`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: submittedQuestion }),
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
            mention.candidates.length === 1 ? [[index, mention.candidates[0]?.oracleId ?? ""]] : [],
          ),
        ),
      );
    } catch (error) {
      if (requestId === interpretationRequestId.current) {
        setRequestError(
          error instanceof Error ? error.message : "Unable to interpret the question.",
        );
      }
    } finally {
      if (requestId === interpretationRequestId.current) setIsInterpreting(false);
    }
  }

  function openCardSearch(mode: SearchMode, initialText = "") {
    searchRequestId.current += 1;
    setIsSearching(false);
    setSearchMode(mode);
    setSearchText(initialText);
    setSearchResults([]);
    setSearchError("");
    setConfirmed(false);
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
        setSearchError("No exact card face match. Try the printed face name.");
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
    searchRequestId.current += 1;
    setIsSearching(false);
    setConfirmed(false);
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
    setConfirmed(false);
    setSelectedByMention((current) => {
      const next = { ...current };
      for (const index of entry.mentionIndexes) delete next[index];
      return next;
    });
    setIgnoredMentions((current) => [...new Set([...current, ...entry.mentionIndexes])]);
    setManualCards((current) => current.filter((card) => card.oracleId !== entry.card.oracleId));
  }

  function adjustCount(oracleId: string, delta: number) {
    setConfirmed(false);
    setCounts((current) => ({
      ...current,
      [oracleId]: Math.max(1, (current[oracleId] ?? 1) + delta),
    }));
  }

  function cycleFace(card: Card) {
    setConfirmed(false);
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

  function confirmCards() {
    searchRequestId.current += 1;
    setIsSearching(false);
    setConfirmed(true);
    setSearchMode(null);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>MTG Rules Lawyer</Text>
        <Text style={styles.subtitle}>Unofficial Magic rules research assistant</Text>
        <Text style={styles.sectionTitle}>Describe the game situation</Text>
        <TextInput
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
            setConfirmed(false);
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
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.primaryButtonText}>Find cards and game facts</Text>
          )}
        </Pressable>
        {requestError ? (
          <Text accessibilityRole="alert" style={styles.errorText}>
            {requestError}
          </Text>
        ) : null}

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
                      <Text style={styles.cardTitle}>Choose a match for “{mention.text}”</Text>
                      {mention.candidates.map((candidate) => (
                        <Pressable
                          key={candidate.oracleId}
                          accessibilityRole="button"
                          accessibilityLabel={`Select ${candidate.name} for ${mention.text}`}
                          onPress={() => {
                            setConfirmed(false);
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
                          No exact match was found in the active Oracle data.
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
                            setConfirmed(false);
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
                      const imageKey = `${card.oracleId}:${faceIndex}`;
                      return (
                        <ConfirmedCardTile
                          key={card.oracleId}
                          card={card}
                          mentionCount={entry.mentionIndexes.length}
                          copyCount={counts[card.oracleId] ?? 1}
                          faceIndex={faceIndex}
                          imageFailed={Boolean(failedImages[imageKey])}
                          onImageError={() =>
                            setFailedImages((current) => ({ ...current, [imageKey]: true }))
                          }
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
                        accessibilityLabel="Exact card face name"
                        onChangeText={(value) => {
                          searchRequestId.current += 1;
                          setIsSearching(false);
                          setSearchResults([]);
                          setSearchError("");
                          setSearchText(value);
                        }}
                        onSubmitEditing={() => void searchCards()}
                        placeholder="Exact card face name"
                        returnKeyType="search"
                        style={styles.searchInput}
                        value={searchText}
                      />
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Search exact card name"
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
                  accessibilityLabel="Confirm selected Oracle card identities"
                  accessibilityHint="Confirms the selected cards before a ruling can be requested."
                  disabled={unresolvedMentionIndexes.length > 0}
                  onPress={confirmCards}
                  style={[
                    styles.primaryButton,
                    unresolvedMentionIndexes.length > 0 && styles.disabledButton,
                  ]}
                >
                  <Text style={styles.primaryButtonText}>Confirm card identities</Text>
                </Pressable>
                {unresolvedMentionIndexes.length > 0 ? (
                  <Text style={styles.helperText}>
                    Choose, find, or remove each of the {unresolvedMentionIndexes.length} unresolved
                    card mention{unresolvedMentionIndexes.length === 1 ? "" : "s"} to continue.
                  </Text>
                ) : null}
                {confirmed ? (
                  <View accessibilityLiveRegion="polite" style={styles.confirmedBox}>
                    <Text style={styles.cardTitle}>Card identities confirmed</Text>
                    <Text>
                      Confirmed Oracle IDs:{" "}
                      {displayCards.length
                        ? displayCards.map(({ card }) => card.oracleId).join(", ")
                        : "No cards"}
                    </Text>
                    <Text style={styles.helperText}>
                      Ruling generation becomes available in the next step.
                    </Text>
                  </View>
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
  safeArea: { flex: 1, backgroundColor: "#f6f3ec" },
  page: {
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    padding: 20,
    gap: 12,
    paddingBottom: 48,
  },
  title: { color: "#18312f", fontSize: 28, fontWeight: "800" },
  subtitle: { color: "#49615c", fontSize: 15 },
  sectionTitle: { marginTop: 12, color: "#18312f", fontSize: 20, fontWeight: "700" },
  questionInput: {
    minHeight: 120,
    borderWidth: 1,
    borderColor: "#9caaa2",
    borderRadius: 12,
    padding: 14,
    backgroundColor: "#fff",
    fontSize: 16,
  },
  helperText: { color: "#596d67", fontSize: 13 },
  primaryButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: "#1f5d50",
  },
  primaryButtonText: { color: "#fff", fontSize: 16, fontWeight: "700", textAlign: "center" },
  secondaryButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#31695d",
    borderRadius: 9,
    backgroundColor: "#fff",
  },
  secondaryButtonText: { color: "#174b40", fontSize: 14, fontWeight: "700", textAlign: "center" },
  pressedButton: { opacity: 0.75 },
  disabledButton: { opacity: 0.45 },
  errorText: { color: "#9d2634", fontWeight: "600" },
  results: { gap: 12 },
  scopeBox: { padding: 14, borderRadius: 10, gap: 5 },
  scopeIn: { backgroundColor: "#e1efe7" },
  scopeOut: { backgroundColor: "#f7e9df" },
  scopeTitle: { color: "#18312f", fontSize: 17, fontWeight: "700" },
  questionPreview: {
    padding: 14,
    borderRadius: 10,
    backgroundColor: "#fff",
    fontSize: 16,
    lineHeight: 25,
  },
  highlight: { borderRadius: 4, backgroundColor: "#ffe49a", color: "#402f00", fontWeight: "800" },
  factsBox: { gap: 7, padding: 14, borderRadius: 10, backgroundColor: "#e9ecef" },
  missingText: { color: "#804700", fontWeight: "600" },
  mentionBox: {
    gap: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: "#d0b064",
    borderRadius: 10,
    backgroundColor: "#fffaf0",
  },
  cardRow: { gap: 12, paddingVertical: 4, paddingRight: 10 },
  cardTitle: { color: "#18312f", fontSize: 16, fontWeight: "700" },
  inlineButtons: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  choiceButton: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#a5b4ab",
    borderRadius: 8,
    backgroundColor: "#fff",
  },
  choiceText: { color: "#18312f", fontWeight: "600" },
  searchPanel: {
    gap: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: "#abbab0",
    borderRadius: 10,
    backgroundColor: "#eef3ee",
  },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  searchInput: {
    flex: 1,
    minHeight: 46,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#9caaa2",
    borderRadius: 8,
    backgroundColor: "#fff",
  },
  confirmedBox: { gap: 8, padding: 14, borderRadius: 10, backgroundColor: "#e1efe7" },
});
