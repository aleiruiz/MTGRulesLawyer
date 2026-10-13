import { colors, eyebrow, fonts } from "../theme";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import CardImage from "../cards/CardImage";
import { Ionicons } from "@expo/vector-icons";
import TextInput from "../ui/TextInput";
import Text from "../ui/Text";
import { SafeAreaView } from "react-native-safe-area-context";
import Loader from "../ui/Loader";
import { router } from "expo-router";
import { saveDraft } from "../chat/draft-store";
import ConfirmedCardTile from "./ConfirmedCardTile";
import {
  QuestionRequestError,
  questionConnectionError,
  questionErrorMessage,
} from "./question-error-message";
import { apiUrl } from "../api-url";
import {
  cardLookupResponseSchema,
  MAX_CONFIRMED_CARDS,
  questionInterpretResponseSchema,
  type CardLookupResponse,
  type QuestionInterpretResponse,
} from "@mtg-rules/contracts";
import { useT } from "../i18n/LanguageProvider";
import { strings } from "../i18n/core";

type Card = CardLookupResponse["cards"][number];
type SearchMode =
  | { type: "add" }
  | { type: "resolve"; mentionIndex: number }
  | { type: "replace"; oracleId: string; mentionIndexes: number[] };
interface DisplayCard {
  card: Card;
  mentionIndexes: number[];
}

interface TableScreenProps {
  /** Undefined when the screen was reloaded and the question is gone. */
  question: string | undefined;
}

// Step two of asking: the judge shows which cards and facts it read from the question, and the
// player fixes anything it got wrong before the ruling is generated.
export default function TableScreen({ question }: TableScreenProps) {
  const { t } = useT();
  const searchRequestId = useRef(0);
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
  const [attempt, setAttempt] = useState(0);

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

  const interpret = useCallback(async (submittedQuestion: string, signal: AbortSignal) => {
    setIsInterpreting(true);
    setRequestError("");
    try {
      const response = await fetch(`${apiUrl}/api/questions/interpret`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: submittedQuestion }),
        signal,
      });
      // A proxy or crash can answer with a non-JSON page; treat it like any other failure.
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const errorBody = typeof body === "object" && body !== null ? body : {};
        const errorCode =
          "error" in errorBody && typeof errorBody.error === "string" ? errorBody.error : undefined;
        const retryAfter =
          "retryAfterSeconds" in errorBody && typeof errorBody.retryAfterSeconds === "number"
            ? errorBody.retryAfterSeconds
            : undefined;
        // No JSON body means a proxy or gateway answered, not the API.
        throw new QuestionRequestError(
          body === null ? questionConnectionError() : questionErrorMessage(errorCode, retryAfter),
        );
      }
      const result = questionInterpretResponseSchema.parse(body);
      if (signal.aborted) return;
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
      if (!signal.aborted) {
        setRequestError(
          error instanceof QuestionRequestError ? error.message : questionConnectionError(),
        );
      }
    } finally {
      if (!signal.aborted) setIsInterpreting(false);
    }
  }, []);

  useEffect(() => {
    if (!question) return undefined;
    const abortController = new AbortController();
    void interpret(question, abortController.signal);
    return () => abortController.abort();
  }, [attempt, interpret, question]);

  function getTheRuling() {
    if (!question) return;
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
    router.replace({ pathname: "/chat", params: { draft: draftId } });
  }

  function editQuestion() {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }

  function openCardSearch(mode: SearchMode, initialText = "") {
    searchRequestId.current += 1;
    setIsSearching(false);
    setSearchMode(mode);
    setSearchText(initialText);
    setSearchResults([]);
    setSearchError("");
  }

  function closeCardSearch() {
    searchRequestId.current += 1;
    setIsSearching(false);
    setSearchMode(null);
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
      if (!response.ok) throw new Error(strings().table.searchFailed);
      const cards = cardLookupResponseSchema.parse(result).cards;
      if (requestId !== searchRequestId.current) return;
      setSearchResults(cards);
      if (cards.length === 0) {
        setSearchError(strings().table.noCardFound);
      }
    } catch (error) {
      if (requestId === searchRequestId.current) {
        setSearchError(error instanceof Error ? error.message : strings().table.searchFailed);
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
      setSearchError(strings().table.maxCardsShort(MAX_CONFIRMED_CARDS));
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
    setFaceIndexes((current) => {
      const currentFace = current[card.oracleId] ?? card.matchedFace.faceIndex;
      const position = card.faces.findIndex((face) => face.faceIndex === currentFace);
      const next = card.faces[(position + 1) % card.faces.length];
      return { ...current, [card.oracleId]: next?.faceIndex ?? currentFace };
    });
  }

  if (!question) {
    return (
      <SafeAreaView edges={["bottom"]} style={styles.safeArea}>
        <View style={styles.centered}>
          <Text style={styles.heading}>{t.table.gone}</Text>
          <Text style={styles.lead}>{t.table.goneLead}</Text>
          <SecondaryButton label={t.table.writeQuestion} onPress={() => router.replace("/")} />
        </View>
      </SafeAreaView>
    );
  }

  const searchPanel = searchMode ? (
    <View style={styles.searchPanel}>
      <Text style={styles.searchTitle}>
        {searchMode.type === "add"
          ? t.table.addTitle
          : searchMode.type === "resolve"
            ? t.table.resolveTitle
            : t.table.replaceTitle}
      </Text>
      <View style={styles.searchRow}>
        <TextInput
          accessibilityLabel={t.table.cardName}
          autoFocus
          onChangeText={(value) => {
            searchRequestId.current += 1;
            setIsSearching(false);
            setSearchResults([]);
            setSearchError("");
            setSearchText(value);
          }}
          onSubmitEditing={() => void searchCards()}
          placeholder={t.table.cardPlaceholder}
          returnKeyType="search"
          style={styles.searchInput}
          value={searchText}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.table.searchCards}
          disabled={isSearching || !searchText.trim()}
          onPress={() => void searchCards()}
          style={[styles.searchButton, (isSearching || !searchText.trim()) && styles.disabled]}
        >
          {isSearching ? (
            <Loader accessibilityLabel={t.table.searching} size={6} color={colors.accentInk} />
          ) : (
            <Ionicons name="search" size={18} color={colors.accentInk} />
          )}
        </Pressable>
      </View>
      {searchError ? (
        <Text accessibilityRole="alert" style={styles.helper}>
          {searchError}
        </Text>
      ) : null}
      {searchResults.map((card) => (
        <Pressable
          key={card.oracleId}
          accessibilityRole="button"
          accessibilityLabel={t.table.chooseCard(card.name)}
          onPress={() => selectSearchResult(card)}
          style={({ pressed }) => [styles.resultRow, pressed && styles.pressed]}
        >
          <Text style={styles.resultName}>{card.name}</Text>
          <Text style={styles.resultType}>{card.matchedFace.typeLine}</Text>
        </Pressable>
      ))}
      <Pressable
        accessibilityRole="button"
        onPress={closeCardSearch}
        style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}
      >
        <Text style={styles.textButtonLabel}>{t.common.cancel}</Text>
      </Pressable>
    </View>
  ) : null;

  const understood = interpretation
    ? [
        ...interpretation.events.map((text) => ({ text, known: true })),
        ...interpretation.knownFacts.map((text) => ({ text, known: true })),
        ...interpretation.missingFacts.map((text) => ({ text, known: false })),
      ]
    : [];
  const blocked = unresolvedMentionIndexes.length > 0;

  return (
    <SafeAreaView edges={["bottom"]} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <View style={styles.intro}>
          <Text accessibilityRole="header" style={styles.heading}>
            {t.table.heading}
          </Text>
          <Text style={styles.lead}>{t.table.lead}</Text>
        </View>

        <View style={styles.questionQuote}>
          <Text numberOfLines={4} style={styles.questionText}>
            {question}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.table.editLabel}
            hitSlop={8}
            onPress={editQuestion}
          >
            <Text style={styles.link}>{t.table.edit}</Text>
          </Pressable>
        </View>

        {isInterpreting ? (
          <View style={styles.waiting}>
            <Loader accessibilityLabel={t.table.reading} />
            <Text style={styles.helper}>{t.table.reading}</Text>
          </View>
        ) : null}

        {requestError ? (
          <View style={styles.notice}>
            <Text accessibilityRole="alert" style={styles.noticeText}>
              {requestError}
            </Text>
            <SecondaryButton
              label={t.common.tryAgain}
              onPress={() => setAttempt((value) => value + 1)}
            />
          </View>
        ) : null}

        {interpretation && !interpretation.inScope ? (
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>{t.table.notRules}</Text>
            <Text style={styles.noticeText}>{interpretation.scopeReason}</Text>
            <SecondaryButton label={t.table.editQuestion} onPress={editQuestion} />
          </View>
        ) : null}

        {interpretation?.inScope ? (
          <>
            {interpretation.cardMentions.map((mention, mentionIndex) => {
              if (selectedByMention[mentionIndex] || ignoredSet.has(mentionIndex)) return null;
              return (
                <View key={`${mention.start}-${mention.end}`} style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <Text accessibilityRole="header" style={styles.eyebrow}>
                      {mention.candidates.length > 0 ? t.table.didYouMean : t.table.notFound}
                    </Text>
                    <Text style={styles.wrote}>{t.table.youWrote(mention.text)}</Text>
                  </View>
                  {mention.candidates.length > 0 ? (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.candidateRow}
                    >
                      {mention.candidates.map((candidate) => (
                        <Pressable
                          key={candidate.oracleId}
                          accessibilityRole="button"
                          accessibilityLabel={t.table.useCandidate(
                            candidate.name,
                            candidate.matchedFace.typeLine,
                            mention.text,
                          )}
                          onPress={() =>
                            setSelectedByMention((current) => ({
                              ...current,
                              [mentionIndex]: candidate.oracleId,
                            }))
                          }
                          style={({ pressed }) => [styles.candidate, pressed && styles.pressed]}
                        >
                          {candidate.matchedFace.imageUri ? (
                            <CardImage
                              uri={candidate.matchedFace.imageUri}
                              style={styles.candidateImage}
                            />
                          ) : (
                            <View style={[styles.candidateImage, styles.candidatePlaceholder]} />
                          )}
                          <Text numberOfLines={2} style={styles.candidateName}>
                            {candidate.name}
                          </Text>
                          <Text numberOfLines={1} style={styles.candidateType}>
                            {candidate.matchedFace.typeLine}
                          </Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  ) : null}
                  <View style={styles.chips}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t.table.searchFor(mention.text)}
                      onPress={() =>
                        openCardSearch({ type: "resolve", mentionIndex }, mention.text)
                      }
                      style={({ pressed }) => [
                        styles.chip,
                        styles.quietChip,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.quietChipText}>{t.table.search}</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t.table.notACardLabel(mention.text)}
                      onPress={() =>
                        setIgnoredMentions((current) => [...new Set([...current, mentionIndex])])
                      }
                      style={({ pressed }) => [
                        styles.chip,
                        styles.quietChip,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.quietChipText}>{t.table.notACard}</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}

            {searchMode?.type === "resolve" ? searchPanel : null}

            <View style={styles.section}>
              <Text accessibilityRole="header" style={styles.eyebrow}>
                {t.table.cardsOnTable}
              </Text>
              {displayCards.length > 0 ? (
                <ScrollView
                  accessibilityLabel={t.table.cardsOnTable}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.cardRow}
                >
                  {displayCards.map((entry) => {
                    const { card } = entry;
                    return (
                      <ConfirmedCardTile
                        key={card.oracleId}
                        card={card}
                        copyCount={counts[card.oracleId] ?? 1}
                        faceIndex={faceIndexes[card.oracleId] ?? card.matchedFace.faceIndex}
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
                <Text style={styles.helper}>{t.table.noCards}</Text>
              )}
            </View>

            {searchMode && searchMode.type !== "resolve" ? (
              searchPanel
            ) : displayCards.length >= MAX_CONFIRMED_CARDS ? (
              <Text style={styles.helper}>{t.table.maxCards(MAX_CONFIRMED_CARDS)}</Text>
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={() => openCardSearch({ type: "add" })}
                style={({ pressed }) => [styles.addCard, pressed && styles.pressed]}
              >
                <Ionicons name="add" size={16} color={colors.textSoft} />
                <Text style={styles.addCardText}>{t.table.addCard}</Text>
              </Pressable>
            )}

            {understood.length > 0 ? (
              <View style={styles.section}>
                <Text accessibilityRole="header" style={styles.eyebrow}>
                  {t.table.understood}
                </Text>
                {understood.map((item, index) => (
                  <View key={`${index}-${item.text}`} style={styles.fact}>
                    <View style={[styles.bullet, !item.known && styles.bulletOpen]} />
                    <Text style={[styles.factText, !item.known && styles.factUnclear]}>
                      {item.known ? (
                        item.text
                      ) : (
                        <>
                          <Text style={styles.unclearLabel}>{t.table.stillUnclear}</Text>
                          {item.text}
                        </>
                      )}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      {interpretation?.inScope ? (
        <View style={styles.footer}>
          {blocked ? (
            <Text style={styles.helper}>{t.table.pickEach(unresolvedMentionIndexes.length)}</Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityHint={t.table.getRulingHint}
            accessibilityState={{ disabled: blocked }}
            disabled={blocked}
            onPress={getTheRuling}
            style={({ pressed }) => [
              styles.primaryButton,
              blocked && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.primaryButtonText}>{t.table.getRuling}</Text>
          </Pressable>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function SecondaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
    >
      <Text style={styles.secondaryButtonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  page: {
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 32,
    gap: 22,
  },
  centered: { flex: 1, justifyContent: "center", padding: 24, gap: 14 },
  intro: { gap: 8 },
  heading: { fontFamily: fonts.display, fontSize: 28, lineHeight: 33 },
  lead: { color: colors.textSoft, fontSize: 14.5, lineHeight: 21 },
  questionQuote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingLeft: 12,
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
  },
  questionText: { flex: 1, color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  link: { color: colors.accent, fontSize: 14 },
  waiting: { alignItems: "center", gap: 10, paddingVertical: 28 },
  helper: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  notice: {
    gap: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.surface,
  },
  noticeTitle: { fontFamily: fonts.bodySemibold, fontSize: 15 },
  noticeText: { color: colors.textSoft, fontSize: 14, lineHeight: 20 },
  section: { gap: 10 },
  sectionHeader: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  eyebrow,
  wrote: { flexShrink: 1, color: colors.textMuted, fontSize: 12.5 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 22,
    backgroundColor: colors.accentSurface,
  },
  chipText: { color: colors.accentText, fontSize: 14 },
  candidateRow: { gap: 12, paddingRight: 8 },
  candidate: { width: 104, gap: 4 },
  candidateImage: { width: 104, height: 145, borderRadius: 6, backgroundColor: colors.surface },
  candidatePlaceholder: { borderWidth: 1, borderColor: colors.border },
  candidateName: { fontSize: 13, lineHeight: 17 },
  candidateType: { color: colors.textMuted, fontSize: 11.5 },
  quietChip: { borderColor: colors.border, backgroundColor: "transparent" },
  quietChipText: { color: colors.textSoft, fontSize: 14 },
  cardRow: { gap: 14, paddingRight: 8 },
  addCard: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
    borderRadius: 14,
  },
  addCardText: { color: colors.textSoft, fontSize: 14 },
  fact: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  bullet: {
    width: 7,
    height: 7,
    marginTop: 7,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.successDot,
    backgroundColor: colors.successDot,
  },
  bulletOpen: { borderColor: colors.warning, backgroundColor: "transparent" },
  factText: { flex: 1, fontSize: 14.5, lineHeight: 21 },
  factUnclear: { color: colors.textSoft },
  unclearLabel: { color: colors.warning, fontFamily: fonts.bodyMedium },
  searchPanel: {
    gap: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.surface,
  },
  searchTitle: { fontFamily: fonts.bodySemibold, fontSize: 15 },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  searchInput: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.background,
    color: colors.text,
    fontSize: 15,
  },
  searchButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
    backgroundColor: colors.accent,
  },
  resultRow: {
    minHeight: 48,
    justifyContent: "center",
    gap: 2,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  resultName: { fontSize: 15 },
  resultType: { color: colors.textMuted, fontSize: 12.5 },
  textButton: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center" },
  textButtonLabel: { color: colors.accent, fontSize: 14 },
  footer: {
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.background,
  },
  primaryButton: {
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 26,
    backgroundColor: colors.accent,
  },
  primaryButtonText: { color: colors.accentInk, fontFamily: fonts.bodySemibold, fontSize: 16 },
  secondaryButton: {
    alignSelf: "flex-start",
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
  },
  secondaryButtonText: { color: colors.text, fontSize: 14 },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
});
