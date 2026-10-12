import { colors, fonts } from "../theme";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AccountButton from "../ui/AccountButton";
import GrimoireBackdrop from "../ui/GrimoireBackdrop";
import ManaLoader from "../ui/ManaLoader";
import ConfirmedCardTile from "./ConfirmedCardTile";
import ChallengeForm from "../challenges/ChallengeForm";
import { apiUrl } from "../api-url";
import { getPublicRulingUrl } from "../rulings/public-ruling-url";
import {
  cardLookupResponseSchema,
  confirmedQuestionEvidenceRequestSchema,
  evidenceSearchResponseSchema,
  MAX_CONFIRMED_CARDS,
  questionInterpretRequestSchema,
  questionInterpretResponseSchema,
  persistedRulingResponseSchema,
  type CardLookupResponse,
  type EvidenceSearchResponse,
  type QuestionInterpretResponse,
  type PersistedRulingResponse,
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
  const evidenceRequestId = useRef(0);
  const rulingRequestId = useRef(0);
  const interpretationAbortController = useRef<AbortController | null>(null);
  const rulingAbortController = useRef<AbortController | null>(null);
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
  const [confirmed, setConfirmed] = useState(false);
  const [isRetrieving, setIsRetrieving] = useState(false);
  const [retrievalError, setRetrievalError] = useState("");
  const [evidence, setEvidence] = useState<EvidenceSearchResponse | null>(null);
  const [isGeneratingRuling, setIsGeneratingRuling] = useState(false);
  const [rulingError, setRulingError] = useState("");
  const [ruling, setRuling] = useState<PersistedRulingResponse | null>(null);

  useEffect(
    () => () => {
      interpretationAbortController.current?.abort();
      rulingAbortController.current?.abort();
    },
    [],
  );

  function invalidateConfirmation() {
    evidenceRequestId.current += 1;
    rulingRequestId.current += 1;
    rulingAbortController.current?.abort();
    rulingAbortController.current = null;
    setConfirmed(false);
    setIsRetrieving(false);
    setRetrievalError("");
    setEvidence(null);
    setIsGeneratingRuling(false);
    setRulingError("");
    setRuling(null);
  }

  function createEvidenceRequest() {
    return confirmedQuestionEvidenceRequestSchema.parse({
      question,
      gameState: {
        events: interpretation?.events ?? [],
        knownFacts: interpretation?.knownFacts ?? [],
        missingFacts: interpretation?.missingFacts ?? [],
        searchTerms: interpretation?.searchTerms ?? [],
      },
      confirmedCards: displayCards.map(({ card }) => ({
        oracleId: card.oracleId,
        faceIndex: faceIndexes[card.oracleId] ?? card.matchedFace.faceIndex,
        quantity: counts[card.oracleId] ?? 1,
      })),
    });
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
    invalidateConfirmation();
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
            mention.candidates.length === 1 ? [[index, mention.candidates[0]?.oracleId ?? ""]] : [],
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
    invalidateConfirmation();
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
    invalidateConfirmation();
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
    invalidateConfirmation();
    setSelectedByMention((current) => {
      const next = { ...current };
      for (const index of entry.mentionIndexes) delete next[index];
      return next;
    });
    setIgnoredMentions((current) => [...new Set([...current, ...entry.mentionIndexes])]);
    setManualCards((current) => current.filter((card) => card.oracleId !== entry.card.oracleId));
  }

  function adjustCount(oracleId: string, delta: number) {
    invalidateConfirmation();
    setCounts((current) => ({
      ...current,
      [oracleId]: Math.max(1, (current[oracleId] ?? 1) + delta),
    }));
  }

  function cycleFace(card: Card) {
    invalidateConfirmation();
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

  async function confirmCards() {
    const requestId = ++evidenceRequestId.current;
    searchRequestId.current += 1;
    setIsSearching(false);
    setSearchMode(null);
    setIsRetrieving(true);
    setRetrievalError("");
    setEvidence(null);
    setRuling(null);
    try {
      const request = createEvidenceRequest();
      const response = await fetch(`${apiUrl}/api/questions/evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const code =
          typeof body === "object" &&
          body !== null &&
          "error" in body &&
          typeof body.error === "string"
            ? body.error.replaceAll("_", " ")
            : "Evidence retrieval failed";
        throw new Error(`${code}. Check the API connection and confirmed card choices.`);
      }
      const result = evidenceSearchResponseSchema.parse(body);
      if (requestId !== evidenceRequestId.current) return;
      setEvidence(result);
      setConfirmed(true);
    } catch (error) {
      if (requestId === evidenceRequestId.current) {
        setRetrievalError(error instanceof Error ? error.message : "Unable to retrieve evidence.");
      }
    } finally {
      if (requestId === evidenceRequestId.current) setIsRetrieving(false);
    }
  }

  async function generateVerifiedRuling() {
    const requestId = ++rulingRequestId.current;
    rulingAbortController.current?.abort();
    const abortController = new AbortController();
    rulingAbortController.current = abortController;
    setIsGeneratingRuling(true);
    setRulingError("");
    setRuling(null);
    try {
      const response = await fetch(`${apiUrl}/api/questions/ruling`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createEvidenceRequest()),
        signal: abortController.signal,
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const code =
          typeof body === "object" &&
          body !== null &&
          "error" in body &&
          typeof body.error === "string"
            ? body.error.replaceAll("_", " ")
            : "Ruling generation failed";
        throw new Error(`${code}. Check the API connection and try again.`);
      }
      const result = persistedRulingResponseSchema.parse(body);
      if (requestId === rulingRequestId.current) setRuling(result);
    } catch (error) {
      if (requestId === rulingRequestId.current && !abortController.signal.aborted) {
        setRulingError(error instanceof Error ? error.message : "Unable to generate a ruling.");
      }
    } finally {
      if (requestId === rulingRequestId.current) {
        rulingAbortController.current = null;
        setIsGeneratingRuling(false);
      }
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <GrimoireBackdrop />
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.title}>
            Rules Lawyer
          </Text>
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
            invalidateConfirmation();
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
                            invalidateConfirmation();
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
                            invalidateConfirmation();
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
                  accessibilityLabel="Confirm selected Oracle card identities"
                  accessibilityHint="Confirms the selected cards before a ruling can be requested."
                  disabled={unresolvedMentionIndexes.length > 0 || isRetrieving}
                  onPress={() => void confirmCards()}
                  style={[
                    styles.primaryButton,
                    (unresolvedMentionIndexes.length > 0 || isRetrieving) && styles.disabledButton,
                  ]}
                >
                  {isRetrieving ? (
                    <ActivityIndicator
                      color={colors.ink}
                      accessibilityLabel="Retrieving evidence"
                    />
                  ) : (
                    <Text style={styles.primaryButtonText}>Confirm card identities</Text>
                  )}
                </Pressable>
                {retrievalError ? (
                  <Text accessibilityRole="alert" style={styles.errorText}>
                    {retrievalError}
                  </Text>
                ) : null}
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
                      Evidence is pinned to the active rules and card snapshot.
                    </Text>
                    {evidence ? (
                      <View accessibilityLabel="Retrieved evidence packet">
                        <Text selectable>
                          Snapshot: {evidence.snapshot.version} · {evidence.snapshot.id}
                        </Text>
                        <Text style={styles.cardTitle}>Sources</Text>
                        {evidence.sources.map((source) => (
                          <Text key={source.id} selectable>
                            {source.kind} · {source.id}
                          </Text>
                        ))}
                        <Text style={styles.cardTitle}>Relevant rules</Text>
                        {evidence.rules.map((rule) => (
                          <Text key={rule.id} numberOfLines={3}>
                            {rule.number}: {rule.text}
                          </Text>
                        ))}
                        {evidence.truncated ? (
                          <Text style={styles.helperText}>Evidence was bounded and truncated.</Text>
                        ) : null}
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Generate a verified rules ruling"
                          disabled={isGeneratingRuling}
                          onPress={() => void generateVerifiedRuling()}
                          style={[
                            styles.primaryButton,
                            isGeneratingRuling && styles.disabledButton,
                          ]}
                        >
                          {isGeneratingRuling ? (
                            <ManaLoader accessibilityLabel="Generating ruling" size={11} />
                          ) : (
                            <Text style={styles.primaryButtonText}>Generate verified ruling</Text>
                          )}
                        </Pressable>
                        {rulingError ? (
                          <Text accessibilityRole="alert" style={styles.errorText}>
                            {rulingError}
                          </Text>
                        ) : null}
                        {ruling ? (
                          <View accessibilityLiveRegion="polite" style={styles.factsBox}>
                            <Text style={styles.cardTitle}>
                              Ruling: {ruling.ruling.outcome.replaceAll("_", " ")}
                            </Text>
                            <Text>{ruling.ruling.summary}</Text>
                            <Text selectable>Ruling ID: {ruling.rulingId}</Text>
                            <ChallengeForm rulingId={ruling.rulingId} />
                            <Pressable
                              accessibilityRole="link"
                              onPress={() =>
                                void Linking.openURL(getPublicRulingUrl(ruling.rulingId))
                              }
                            >
                              <Text style={styles.link}>Open public ruling</Text>
                            </Pressable>
                            <Text>
                              Snapshot: {ruling.ruling.snapshot.version} ·{" "}
                              {ruling.ruling.snapshot.activatedAt
                                ? new Date(ruling.ruling.snapshot.activatedAt).toLocaleDateString()
                                : "activation date unavailable"}
                            </Text>
                            {displayCards.length > 0 ? (
                              <View
                                accessibilityLabel="Cards in this ruling"
                                style={styles.cardRow}
                              >
                                {displayCards.map(({ card }) => (
                                  <Text key={card.oracleId}>
                                    {card.name} · ×{counts[card.oracleId] ?? 1}
                                  </Text>
                                ))}
                              </View>
                            ) : null}
                            {ruling.ruling.assumptions.map((item) => (
                              <Text key={item}>Assumption: {item}</Text>
                            ))}
                            {ruling.ruling.summaryCitationIds.length > 0 ? (
                              <Text style={styles.helperText}>
                                Summary evidence:{" "}
                                {ruling.ruling.summaryCitationIds
                                  .map((id) => {
                                    const citationIndex = ruling.ruling.citations.findIndex(
                                      (citation) => citation.id === id,
                                    );
                                    return `[${citationIndex + 1}] ${ruling.ruling.citations[citationIndex]?.label ?? id}`;
                                  })
                                  .join(", ")}
                              </Text>
                            ) : null}
                            {ruling.ruling.reasoningSteps.map((step, index) => (
                              <View key={`${index}-${step.text}`}>
                                <Text>
                                  {index + 1}. {step.text}
                                </Text>
                                <Text style={styles.helperText}>
                                  Evidence:{" "}
                                  {step.citationIds
                                    .map((id) => {
                                      const citationIndex = ruling.ruling.citations.findIndex(
                                        (citation) => citation.id === id,
                                      );
                                      return `[${citationIndex + 1}] ${ruling.ruling.citations[citationIndex]?.label ?? id}`;
                                    })
                                    .join(", ")}
                                </Text>
                              </View>
                            ))}
                            {ruling.ruling.clarificationQuestions.map((item) => (
                              <Text key={item} style={styles.missingText}>
                                {item}
                              </Text>
                            ))}
                            {ruling.ruling.citations.map((citation, index) => (
                              <Text key={citation.id} selectable>
                                [{index + 1}] {citation.kind} {citation.label} · Source{" "}
                                {citation.sourceId}
                                {"\n"}
                                {citation.sourceUrl}
                                {"\n"}
                                {citation.excerpt}
                              </Text>
                            ))}
                            <Pressable
                              accessibilityRole="button"
                              disabled={isGeneratingRuling}
                              onPress={() => void generateVerifiedRuling()}
                              style={[
                                styles.secondaryButton,
                                isGeneratingRuling && styles.disabledButton,
                              ]}
                            >
                              <Text style={styles.secondaryButtonText}>
                                Rerun ruling with current question and cards
                              </Text>
                            </Pressable>
                          </View>
                        ) : null}
                      </View>
                    ) : null}
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
