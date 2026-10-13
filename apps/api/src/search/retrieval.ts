import { Prisma, SnapshotStatus, type PrismaClient } from "@prisma/client";
import {
  evidenceSearchRequestSchema,
  evidenceSearchResponseSchema,
  confirmedQuestionEvidenceRequestSchema,
  MAX_CONFIRMED_CARDS,
  type ConfirmedQuestionEvidenceRequest,
  type EvidenceSearchRequest,
  type EvidenceSearchResponse,
} from "@mtg-rules/contracts";
import { findExactFaceMatches } from "../cards/lookup.js";
import { prisma } from "../db/client.js";

const MAX_MATCHING_RULES = 8;
const MAX_QUERY_TERMS = 32;
const MAX_RANKING_TERMS = 16;
// Terms found in more than this share of rules say little about which rule applies.
const MAX_TERM_RULE_SHARE = 0.08;
// ...except in small rule sets (fixtures, partial imports), where every term is "common".
const MIN_COMMON_TERM_RULES = 25;
const MAX_KEYWORDS = 3;
const KEYWORD_RULES_PER_HEADING = 2;
const MAX_KEYWORD_HEADING_CHARACTERS = 40;
const MAX_EXPANDED_RULES = 24;
const MAX_REFERENCES_PER_RULE = 12;
const MAX_CARDS_PER_NAME = 3;
const MAX_EVIDENCE_CARDS = MAX_CONFIRMED_CARDS;
const MAX_CARD_EVIDENCE_CHARACTERS = 8_000;
const MAX_RULE_EVIDENCE_CHARACTERS = 16_000;
const MAX_RULE_TEXT_CHARACTERS = 6_000;
const MAX_CARD_TEXT_CHARACTERS = 2_000;
// A rule whose text only introduces its subrules ("...according to the following rules:")
// brings its first subrules, which hold the actual rule.
const MAX_HEADING_RULE_CHARACTERS = 300;
const MAX_SUBRULES_PER_HEADING = 4;
const MAX_HEADINGS_EXPANDED = 3;
// Subrules count against the prompt's searched-rule limit, so few are added overall.
const MAX_SUBRULES_ADDED = 4;
// Every subrule of a keyword ability a confirmed card has ("Double strike", "Trample"), so the
// exceptions are there too (702.19d: a trampler whose blocker is gone deals all its damage to
// the player).
// Three keywords at four rules each fill the twelve slots, so none is dropped.
const MAX_CARD_KEYWORDS = 3;
const MAX_RULES_PER_CARD_KEYWORD = 8;
const MAX_CARD_KEYWORD_RULES = 12;
const SEARCHED_RULES_BEFORE_KEYWORDS = 6;
const RULE_NUMBER = /\b\d{3}(?:\.\d+[a-z]?)?\b/gi;

/**
 * Rules for card layouts whose second face is not a card the player casts. A preparation
 * card's inset spell is only ever cast as a copy from exile (722.3), and a copy of a spell
 * ceases to exist once it leaves the stack (707.10a), so "I cast Lightning Bolt" from Emeritus
 * of Conflict never puts an instant in the graveyard.
 */
const LAYOUT_RULE_NUMBERS: Record<string, string[]> = {
  prepare: ["722.2a", "722.3", "722.3a", "722.3c", "722.4", "707.10", "707.10a"],
};

/** The rule numbers the confirmed cards' layouts bring, in a stable order without repeats. */
export function layoutRuleNumbers(layouts: string[]): string[] {
  return [...new Set(layouts.flatMap((layout) => LAYOUT_RULE_NUMBERS[layout] ?? []))];
}

interface RuleHit {
  id: string;
  number: string;
  text: string;
  parentId: string | null;
  parent: { id: string; number: string; text: string; parentId: string | null } | null;
  referencesOut: Array<{
    toRule: {
      id: string;
      snapshotId: string;
      number: string;
      text: string;
      parentId: string | null;
    };
  }>;
}

type IncludeReason = "MATCH" | "REFERENCE" | "PARENT";

/**
 * Foundational rules every ruling needs to reason about how Magic works, whatever the question
 * says: priority (117), the stack and resolution (405, 603.3b, 608), turn structure (500.1,
 * 506.1), combat damage and the everyday combat keywords (509-510, 702), state-based actions
 * (704), the layer system (613) and loops (104.4b, 732). They are added after the
 * search results as CORE evidence, with their own prompt budget, so they never crowd out
 * question-specific rules.
 */
export const CORE_RULE_NUMBERS = [
  "117.3a",
  "117.3b",
  "117.3c",
  "117.4",
  "405.1",
  "405.5",
  // Countering: what happens to a countered spell or ability.
  "701.6a",
  "603.3b",
  "608.1",
  "608.2g",
  "500.1",
  "506.1",
  // A creature that leaves the battlefield is removed from combat (no longer blocking).
  "506.4",
  // Combat damage, preloaded like the stack: blocked status lasts (509.1h); how attackers and
  // blockers assign damage, including with no blockers left (510.1a-d); damage is dealt at
  // once, then priority (510.2-510.3); first and double strike's extra step (510.4); trample
  // and deathtouch assignment (702.19b, 702.19d, 702.2c).
  "509.1h",
  "510.1a",
  "510.1b",
  "510.1c",
  "510.1d",
  "510.2",
  "510.3",
  "510.4",
  // The everyday combat keywords, whichever cards are involved: deathtouch, indestructible
  // and trample. First and double strike's extra damage step is 510.4 above (702.4b and
  // 702.7b repeat it).
  "702.2b",
  "702.2c",
  "702.12b",
  "702.19b",
  "702.19d",
  "302.6",
  // Loops: a mandatory loop is a draw, an optional one is shortcut to a chosen number.
  "104.4b",
  "732.1b",
  "732.2a",
  "732.4",
  "704.3",
  "704.5a",
  "704.5f",
  "704.5g",
  // +1/+1 and -1/-1 counters cancel as a state-based action, not before.
  "704.5q",
  "613.1",
  "613.1a",
  "613.1b",
  "613.1c",
  "613.1d",
  "613.1e",
  "613.1f",
  "613.1g",
  "613.4",
  "613.4a",
  "613.4b",
  "613.4c",
  // An effect that started applying keeps applying even if its ability is removed.
  "613.6",
  "613.7",
  "613.7a",
  "613.8",
  "613.8a",
  "613.8b",
  "613.8c",
];

export async function assembleEvidence(
  input: EvidenceSearchRequest,
  client: PrismaClient = prisma,
  snapshotId?: string,
): Promise<EvidenceSearchResponse> {
  const request = evidenceSearchRequestSchema.parse(input);
  const snapshot = await client.dataSnapshot.findFirst({
    where: snapshotId
      ? { id: snapshotId, status: SnapshotStatus.ACTIVE }
      : { status: SnapshotStatus.ACTIVE },
    include: { sources: { orderBy: { kind: "asc" } } },
  });
  if (!snapshot) {
    throw new Error("No active rules and card snapshot is available.");
  }

  const cardBudget = { remaining: MAX_CARD_EVIDENCE_CHARACTERS, truncated: false };
  const ruleBudget = { remaining: MAX_RULE_EVIDENCE_CHARACTERS, truncated: false };
  const cards: EvidenceSearchResponse["cards"] = [];
  const seenCards = new Set<string>();
  for (const name of [...new Set(request.cardNames.map((value) => value.trim()))]) {
    if (cards.length >= MAX_EVIDENCE_CARDS) {
      cardBudget.truncated = true;
      break;
    }
    const matches = await findExactFaceMatches(name, snapshot.id, client, MAX_CARDS_PER_NAME + 1);
    if (matches.length > MAX_CARDS_PER_NAME) cardBudget.truncated = true;
    for (const match of matches.slice(0, MAX_CARDS_PER_NAME)) {
      if (cards.length >= MAX_EVIDENCE_CARDS) {
        cardBudget.truncated = true;
        break;
      }
      const card = match.card;
      if (seenCards.has(card.id)) continue;
      seenCards.add(card.id);
      const faces = card.faces.map((face) => {
        const faceText = takeText(face.oracleText, MAX_CARD_TEXT_CHARACTERS, cardBudget);
        return {
          id: face.id,
          faceIndex: face.faceIndex,
          role: face.role,
          name: face.name,
          oracleText: faceText.value,
          truncated: faceText.truncated,
          ...faceCharacteristics(face),
        };
      });
      const matchedFace = faces.find((face) => face.id === match.id);
      if (!matchedFace) continue;
      cards.push({
        id: card.id,
        oracleId: card.oracleId,
        name: card.name,
        layout: card.layout,
        manaValue: card.manaValue,
        selectedFaceIndex: match.faceIndex,
        quantity: 1,
        matchedFace,
        faces,
      });
    }
  }

  const exactRuleNumbersFound = [...new Set(request.question.match(RULE_NUMBER) ?? [])];
  if (exactRuleNumbersFound.length > MAX_MATCHING_RULES) ruleBudget.truncated = true;
  const exactRuleNumbers = exactRuleNumbersFound
    .slice(0, MAX_MATCHING_RULES)
    .map((number) => number.toLowerCase());
  const exactHits = exactRuleNumbers.length
    ? await client.rule.findMany({
        where: { snapshotId: snapshot.id, number: { in: exactRuleNumbers } },
        orderBy: { sortOrder: "asc" },
        select: { id: true, number: true },
      })
    : [];
  // Requiring every term (websearch_to_tsquery) found nothing for real questions. Instead, take
  // the first MAX_QUERY_TERMS distinct terms of the question, keep the rarest ones that are not
  // in most rules ("creature", "player"), and rank rules that contain any of them, discounting
  // long rules. Bounding the terms keeps a 4,000-character question as fast as a short one.
  // Keywords the question names ("hexproof", "trample") always bring the rules that define
  // them, since rules sharing several commoner terms would otherwise outrank the definition.
  const fullTextHits = await client.$queryRaw<Array<{ id: string; number: string }>>(Prisma.sql`
    WITH snapshot_rules AS NOT MATERIALIZED (
      SELECT r."id", r."number", r."sortOrder", r."parentId", length(r."text") AS "textLength",
        to_tsvector('english', r."text") AS document
      FROM "Rule" AS r
      WHERE r."snapshotId" = ${snapshot.id}::uuid
    ),
    question_terms AS (
      SELECT term.lexeme, term.positions[1] AS position
      FROM unnest(to_tsvector('english', ${request.question})) AS term
      ORDER BY term.positions[1]
      LIMIT ${MAX_QUERY_TERMS}
    ),
    term_frequency AS (
      SELECT question_terms.lexeme, question_terms.position,
        (SELECT count(*) FROM snapshot_rules
          WHERE snapshot_rules.document @@ quote_literal(question_terms.lexeme)::tsquery) AS rules
      FROM question_terms
    ),
    rare_terms AS (
      SELECT quote_literal(term_frequency.lexeme)::tsquery AS term
      FROM term_frequency
      WHERE term_frequency.rules > 0
        AND term_frequency.rules <= GREATEST(
          (SELECT count(*) FROM snapshot_rules) * ${MAX_TERM_RULE_SHARE},
          ${MIN_COMMON_TERM_RULES}
        )
      ORDER BY term_frequency.rules ASC
      LIMIT ${MAX_RANKING_TERMS}
    ),
    query AS (
      SELECT string_agg(rare_terms.term::text, ' | ')::tsquery AS terms FROM rare_terms
    ),
    keyword_headings AS (
      -- Keyword abilities (702.x) are headed by a rule whose whole text is the keyword
      -- ("702.2. Deathtouch", "702.19. Trample"). A heading counts when every word of it appears in
      -- the question. Keyword actions (701.x: cast, destroy...) are everyday words, so they are left
      -- to the ranked search; card names have no heading at all.
      SELECT snapshot_rules."id",
        (SELECT min(question_terms.position) FROM question_terms
          WHERE snapshot_rules.document @@ quote_literal(question_terms.lexeme)::tsquery)
          AS position
      FROM snapshot_rules
      WHERE snapshot_rules."number" ~ '^702[.][0-9]+$'
        AND snapshot_rules."textLength" <= ${MAX_KEYWORD_HEADING_CHARACTERS}
        AND length(snapshot_rules.document) > 0
        AND NOT EXISTS (
          SELECT 1 FROM unnest(snapshot_rules.document) AS heading_term
          WHERE heading_term.lexeme NOT IN (SELECT question_terms.lexeme FROM question_terms)
        )
      ORDER BY position ASC
      LIMIT ${MAX_KEYWORDS}
    ),
    keyword_hits AS (
      -- The first rules under each heading define the keyword.
      SELECT "id", "number", "sortOrder"
      FROM (
        SELECT snapshot_rules."id", snapshot_rules."number", snapshot_rules."sortOrder",
          row_number() OVER (
            PARTITION BY snapshot_rules."parentId" ORDER BY snapshot_rules."sortOrder"
          ) AS position
        FROM keyword_headings
        JOIN snapshot_rules ON snapshot_rules."parentId" = keyword_headings."id"
      ) AS defining
      WHERE defining.position <= ${KEYWORD_RULES_PER_HEADING}
    ),
    ranked_hits AS (
      -- A rule sharing more of the question's distinct terms comes first; cover density only
      -- breaks ties, so one term repeated in a long rule cannot outrank broader overlap.
      SELECT snapshot_rules."id", snapshot_rules."number", snapshot_rules."sortOrder",
        (SELECT count(*) FROM rare_terms WHERE snapshot_rules.document @@ rare_terms.term)
          AS shared,
        ts_rank_cd(snapshot_rules.document, query.terms, 1) AS rank
      FROM snapshot_rules, query
      WHERE snapshot_rules.document @@ query.terms
    )
    SELECT hits."id", hits."number"
    FROM (
      SELECT "id", "number", "sortOrder", 0 AS tier, 0::bigint AS shared, 0::real AS rank
      FROM keyword_hits
      UNION ALL
      SELECT "id", "number", "sortOrder", 1 AS tier, shared, rank FROM ranked_hits
    ) AS hits
    GROUP BY hits."id", hits."number"
    ORDER BY min(hits.tier) ASC, max(hits.shared) DESC, max(hits.rank) DESC,
      min(hits."sortOrder") ASC
    LIMIT ${MAX_MATCHING_RULES + 1}
  `);
  if (fullTextHits.length > MAX_MATCHING_RULES) ruleBudget.truncated = true;
  const matches = new Map<string, IncludeReason>();
  for (const rule of exactHits) matches.set(rule.id, "MATCH");
  for (const rule of fullTextHits.slice(0, MAX_MATCHING_RULES)) matches.set(rule.id, "MATCH");

  const included = new Map<string, { rule: RuleHit; reason: IncludeReason }>();
  const frontier = [...matches].map(([id, reason]) => ({ id, reason }));
  while (frontier.length > 0 && included.size < MAX_EXPANDED_RULES) {
    const room = MAX_EXPANDED_RULES - included.size;
    const batch = frontier.splice(0, room);
    const ids = batch.map(({ id }) => id).filter((id) => !included.has(id));
    if (ids.length === 0) continue;
    const rows = (await client.rule.findMany({
      where: { id: { in: ids }, snapshotId: snapshot.id },
      include: {
        parent: { select: { id: true, number: true, text: true, parentId: true } },
        referencesOut: {
          take: MAX_REFERENCES_PER_RULE + 1,
          orderBy: { toRule: { sortOrder: "asc" } },
          include: {
            toRule: {
              select: { id: true, snapshotId: true, number: true, text: true, parentId: true },
            },
          },
        },
      },
    })) as RuleHit[];
    const reasons = new Map(batch.map(({ id, reason }) => [id, reason]));
    // findMany does not keep the order of `ids`; restore it so higher-priority rules come first.
    const position = new Map(ids.map((id, index) => [id, index]));
    rows.sort((left, right) => (position.get(left.id) ?? 0) - (position.get(right.id) ?? 0));
    for (const rule of rows) {
      if (rule.referencesOut.length > MAX_REFERENCES_PER_RULE) ruleBudget.truncated = true;
      if (included.size >= MAX_EXPANDED_RULES) break;
      if (!included.has(rule.id)) {
        included.set(rule.id, { rule, reason: reasons.get(rule.id) ?? "REFERENCE" });
      }
      if (rule.parent && !included.has(rule.parent.id)) {
        frontier.push({ id: rule.parent.id, reason: "PARENT" });
      }
      for (const reference of rule.referencesOut.slice(0, MAX_REFERENCES_PER_RULE)) {
        const target = reference.toRule;
        if (target.snapshotId === snapshot.id && !included.has(target.id)) {
          frontier.push({ id: target.id, reason: "REFERENCE" });
        }
      }
    }
  }
  if (included.size >= MAX_EXPANDED_RULES && frontier.some(({ id }) => !included.has(id))) {
    ruleBudget.truncated = true;
  }

  const rules: EvidenceSearchResponse["rules"] = [];
  for (const { rule, reason } of included.values()) {
    const text = takeText(rule.text, MAX_RULE_TEXT_CHARACTERS, ruleBudget);
    if (!text.value) continue;
    rules.push({
      id: rule.id,
      number: rule.number,
      text: text.value,
      parentNumber: rule.parent?.number ?? null,
      includedBecause: reason,
      truncated: text.truncated,
    });
  }

  return evidenceSearchResponseSchema.parse({
    snapshot: {
      id: snapshot.id,
      version: snapshot.version,
      activatedAt: snapshot.activatedAt?.toISOString() ?? null,
    },
    sources: snapshot.sources.map((source) => ({
      id: source.id,
      kind: source.kind,
      sourceUrl: source.sourceUrl,
      sourceVersion: source.sourceVersion,
      sourcePublishedAt: source.sourcePublishedAt?.toISOString() ?? null,
      checksumSha256: source.checksumSha256,
    })),
    cards,
    rules,
    truncated: cardBudget.truncated || ruleBudget.truncated,
  });
}

export class InvalidConfirmedCardsError extends Error {
  constructor() {
    super("One or more confirmed card IDs or faces are unavailable in the active snapshot.");
    this.name = "InvalidConfirmedCardsError";
  }
}

export async function assembleConfirmedEvidence(
  input: ConfirmedQuestionEvidenceRequest,
  client: PrismaClient = prisma,
): Promise<EvidenceSearchResponse> {
  const request = confirmedQuestionEvidenceRequestSchema.parse(input);
  const snapshot = await client.dataSnapshot.findFirst({
    where: { status: SnapshotStatus.ACTIVE },
    select: { id: true },
  });
  if (!snapshot) throw new Error("No active rules and card snapshot is available.");

  const confirmedCards = request.confirmedCards.length
    ? await client.card.findMany({
        where: {
          snapshotId: snapshot.id,
          oracleId: { in: request.confirmedCards.map(({ oracleId }) => oracleId) },
        },
        include: {
          faces: { orderBy: { faceIndex: "asc" } },
          rulings: { orderBy: { position: "asc" } },
        },
      })
    : [];
  const cardsByOracleId = new Map(confirmedCards.map((card) => [card.oracleId, card]));
  if (cardsByOracleId.size !== request.confirmedCards.length)
    throw new InvalidConfirmedCardsError();

  const selectedCards = request.confirmedCards.map((selection) => {
    const card = cardsByOracleId.get(selection.oracleId);
    const face = card?.faces.find(({ faceIndex }) => faceIndex === selection.faceIndex);
    if (!card || !face) throw new InvalidConfirmedCardsError();
    return { card, face, quantity: selection.quantity };
  });
  // Search terms come first: the search keeps the earliest terms, and these were chosen for it.
  // Multi-word card names are removed from the text ("Sakashima of a Thousand Faces" otherwise
  // pulls in the face-down rules) and the confirmed cards' rules text is searched too, so
  // keywords and abilities the cards have ("split second") find their rules.
  const namesOf = (card: (typeof selectedCards)[number]["card"]) => [
    card.name,
    ...card.faces.map((cardFace) => cardFace.name),
  ];
  const cardNames = selectedCards.flatMap(({ card }) => namesOf(card));
  // Each card's text loses only its own name ("Samut" in Samut's text), never another card's.
  const cardText = selectedCards.map(({ card, face }) =>
    withoutCardNames(face.oracleText || card.oracleText, namesOf(card)),
  );
  const query = [
    ...request.gameState.searchTerms,
    withoutCardNames(request.question, cardNames),
    ...request.gameState.events,
    ...request.gameState.knownFacts,
    ...cardText,
    ...request.gameState.missingFacts,
  ]
    .join("\n")
    .slice(0, 4_000);
  const searched = await assembleEvidence({ question: query, cardNames: [] }, client, snapshot.id);
  const keywordRules = await rulesForCardKeywords(
    selectedCards.map(({ card, face }) => face.oracleText || card.oracleText),
    request.question,
    snapshot.id,
    client,
  );
  const keywordIds = new Set(keywordRules.map(({ id }) => id));
  const layoutNumbers = layoutRuleNumbers(selectedCards.map(({ card }) => card.layout));
  const layoutRows = layoutNumbers.length
    ? await client.rule.findMany({
        where: { snapshotId: snapshot.id, number: { in: layoutNumbers } },
        orderBy: { sortOrder: "asc" },
        select: { id: true, number: true, text: true, parent: { select: { number: true } } },
      })
    : [];
  const layoutRules = layoutRows
    .filter(({ id }) => !keywordIds.has(id))
    .map((rule) => ({
      id: rule.id,
      number: rule.number,
      text: rule.text.slice(0, MAX_RULE_TEXT_CHARACTERS),
      parentNumber: rule.parent?.number ?? null,
      includedBecause: "MATCH" as const,
      truncated: rule.text.length > MAX_RULE_TEXT_CHARACTERS,
    }));
  const cardRuleIds = new Set([...keywordIds, ...layoutRules.map(({ id }) => id)]);
  const searchedRules = (await withSubrulesOfHeadings(searched.rules, snapshot.id, client)).filter(
    ({ id }) => !cardRuleIds.has(id),
  );
  // The search's best matches stay first; the cards' keyword and layout rules follow them,
  // ahead of the rest of the search, so all fit the prompt's searched-rule limit.
  const packet = {
    ...searched,
    rules: [
      ...searchedRules.slice(0, SEARCHED_RULES_BEFORE_KEYWORDS),
      ...keywordRules,
      ...layoutRules,
      ...searchedRules.slice(SEARCHED_RULES_BEFORE_KEYWORDS),
    ],
  };
  const coreRows = await client.rule.findMany({
    where: { snapshotId: snapshot.id, number: { in: CORE_RULE_NUMBERS } },
    orderBy: { sortOrder: "asc" },
    select: { id: true, number: true, text: true, parent: { select: { number: true } } },
  });
  const rules = withCoreRules(
    packet.rules,
    coreRows.map((rule) => ({
      id: rule.id,
      number: rule.number,
      text: rule.text.slice(0, MAX_RULE_TEXT_CHARACTERS),
      parentNumber: rule.parent?.number ?? null,
      includedBecause: "CORE" as const,
      truncated: rule.text.length > MAX_RULE_TEXT_CHARACTERS,
    })),
  );
  const cardBudget = { remaining: MAX_CARD_EVIDENCE_CHARACTERS, truncated: false };
  const cards: EvidenceSearchResponse["cards"] = selectedCards.map(({ card, face, quantity }) => {
    const otherNames = selectedCards
      .filter((other) => other.card.id !== card.id)
      .flatMap((other) => namesOf(other.card));
    // Every official ruling for the card, whole and never cut (as decided by the maintainer on
    // 2026-10-12: a cut ruling can say the opposite of the full one), most relevant first. The
    // largest card has 32 rulings and about 8,500 characters.
    const rulings = rankRulings(card.rulings, request.question, otherNames, namesOf(card)).map(
      (ruling) => ({
        id: ruling.id,
        publishedAt: ruling.publishedAt.toISOString().slice(0, 10),
        text: ruling.text,
        truncated: false,
      }),
    );
    const faces = card.faces.map((cardFace) => {
      const faceText = takeText(cardFace.oracleText, MAX_CARD_TEXT_CHARACTERS, cardBudget);
      return {
        id: cardFace.id,
        faceIndex: cardFace.faceIndex,
        role: cardFace.role,
        name: cardFace.name,
        oracleText: faceText.value,
        truncated: faceText.truncated,
        ...faceCharacteristics(cardFace),
      };
    });
    const matchedFace = faces.find(({ id }) => id === face.id);
    if (!matchedFace) throw new InvalidConfirmedCardsError();
    return {
      id: card.id,
      oracleId: card.oracleId,
      name: card.name,
      layout: card.layout,
      manaValue: card.manaValue,
      selectedFaceIndex: face.faceIndex,
      quantity,
      matchedFace,
      faces,
      ...(rulings.length > 0 ? { rulings } : {}),
    };
  });

  return evidenceSearchResponseSchema.parse({
    ...packet,
    cards,
    rules,
    truncated: packet.truncated || cardBudget.truncated,
  });
}

const RULING_STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "because",
  "before",
  "card",
  "cards",
  "cast",
  "does",
  "doesn't",
  "each",
  "from",
  "have",
  "into",
  "it's",
  "just",
  "more",
  "only",
  "other",
  "same",
  "still",
  "than",
  "that",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "what",
  "when",
  "where",
  "which",
  "while",
  "will",
  "with",
  "would",
  "your",
]);

/**
 * A card's official rulings ordered by how much they bear on the question: rulings that name
 * another confirmed card first, then by how many of the question's words they share. Ties keep
 * the published order.
 */
export function rankRulings<T extends { text: string; position: number }>(
  rulings: T[],
  question: string,
  otherCardNames: string[],
  ownNames: string[] = [],
): T[] {
  // The card's own name is in most of its rulings, so it says nothing about relevance.
  const ownWords = new Set(
    ownNames
      .join(" ")
      .toLowerCase()
      .match(/[a-z][a-z'-]{3,}/g) ?? [],
  );
  const words = new Set(
    (question.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? [])
      .filter((word) => !RULING_STOP_WORDS.has(word) && !ownWords.has(word))
      // Plain stems, so "lands" matches "land" and "copying" matches "copy".
      .map((word) =>
        word.length > 6 && word.endsWith("ing")
          ? word.slice(0, -3)
          : word.length > 4
            ? word.replace(/s$/, "")
            : word,
      ),
  );
  const names = otherCardNames.map((name) => name.toLowerCase()).filter((name) => name.length > 2);
  const score = (text: string) => {
    const lower = text.toLowerCase();
    const named = names.some((name) => lower.includes(name)) ? 100 : 0;
    const shared = [...words].filter((word) => lower.includes(word)).length;
    return named + shared;
  };
  return rulings
    .map((ruling) => ({ ruling, score: score(ruling.text) }))
    .sort((a, b) => b.score - a.score || a.ruling.position - b.ruling.position)
    .map(({ ruling }) => ruling);
}

const MAX_REQUESTED_RULES = 6;
const normalizeRuleNumber = (value: string) =>
  value
    .trim()
    .replace(/^rule\s+/i, "")
    .replace(/\.$/, "")
    .toLowerCase();
const REQUESTABLE_RULE_NUMBER = /^\d{3}\.\d+[a-z]?$/;

/**
 * Adds the rules a first answer asked for (by number) to the evidence, as REQUESTED rules with
 * their real text from the same snapshot. Returns null when none of the numbers names a rule.
 * A requested rule already in the packet moves to REQUESTED, so the prompt bound keeps it.
 */
export async function addRequestedRules(
  evidence: EvidenceSearchResponse,
  numbers: string[],
  client: PrismaClient = prisma,
): Promise<EvidenceSearchResponse | null> {
  const wanted = [...new Set(numbers.map(normalizeRuleNumber))]
    .filter((number) => REQUESTABLE_RULE_NUMBER.test(number))
    .slice(0, MAX_REQUESTED_RULES);
  if (wanted.length === 0) return null;
  const rows = await client.rule.findMany({
    where: { snapshotId: evidence.snapshot.id, number: { in: wanted } },
    orderBy: { sortOrder: "asc" },
    select: { id: true, number: true, text: true, parent: { select: { number: true } } },
  });
  if (rows.length === 0) return null;
  const requestedIds = new Set(rows.map(({ id }) => id));
  return evidenceSearchResponseSchema.parse({
    ...evidence,
    rules: [
      ...evidence.rules.filter(({ id }) => !requestedIds.has(id)),
      ...rows.map((rule) => ({
        id: rule.id,
        number: rule.number,
        text: rule.text.slice(0, MAX_RULE_TEXT_CHARACTERS),
        parentNumber: rule.parent?.number ?? null,
        includedBecause: "REQUESTED" as const,
        truncated: rule.text.length > MAX_RULE_TEXT_CHARACTERS,
      })),
    ],
  });
}

/**
 * The subrules of the keyword abilities the cards have, read from their keyword lines
 * ("Double strike, trample"), each keyword's rules in order. Keyword headings are the 702.x
 * rules whose whole text is the keyword ("702.19. Trample").
 */
export async function rulesForCardKeywords(
  cardTexts: string[],
  question: string,
  snapshotId: string,
  client: PrismaClient = prisma,
): Promise<EvidenceSearchResponse["rules"]> {
  const keywordLines = cardTexts
    .flatMap((text) => text.split("\n"))
    .map((line) =>
      line
        .replace(/\([^)]*\)/g, "")
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean)
    // Keywords a card grants ("Equipped creature gets +1/+1 and has double strike and
    // trample.", "Creatures you control gain flying until end of turn.") count too: the list
    // after has/have/gain(s) becomes its own keyword line.
    .flatMap((line) => [
      line,
      ...[
        ...line.matchAll(
          /\b(?:has|have|gains?)\s+([a-z ,'-]+?)(?:\.|$|\s+until\b|\s+as long\b|\s+for\b)/g,
        ),
      ].map((match) => (match[1] ?? "").replace(/\s+and\s+/g, ", ")),
    ]);
  if (keywordLines.length === 0) return [];
  const headings = await client.rule.findMany({
    // Only the keyword headings (children of 702), not their thousand subrules.
    where: { snapshotId, parent: { number: "702" } },
    orderBy: { sortOrder: "asc" },
    select: { id: true, number: true, text: true },
  });
  const keywords = headings
    .filter(({ number, text }) => /^702\.\d+$/.test(number) && text.length <= 40)
    .filter(({ text }) => {
      const keyword = text.trim().toLowerCase();
      // A keyword line lists keywords separated by commas, each maybe followed by a cost or
      // number ("Ward {2}", "Disguise {3}{R}{R}", "Toxic 1").
      return keywordLines.some((line) =>
        line.split(/[,;]\s*/).some(
          (part) =>
            part === keyword ||
            part.startsWith(`${keyword} `) ||
            // "Ward—Pay 3 life", "Escape—{3}{B}{B}, Exile five other cards"
            part.startsWith(`${keyword}—`),
        ),
      );
    })
    // Keywords the question names come first, then rules order.
    .map((keyword, order) => ({
      keyword,
      named: question.toLowerCase().includes(keyword.text.trim().toLowerCase()) ? 0 : 1,
      order,
    }))
    .sort((a, b) => a.named - b.named || a.order - b.order)
    .map(({ keyword }) => keyword)
    .slice(0, MAX_CARD_KEYWORDS);
  if (keywords.length === 0) return [];
  const subrules = await client.rule.findMany({
    where: { snapshotId, parentId: { in: keywords.map(({ id }) => id) } },
    orderBy: { sortOrder: "asc" },
    select: { id: true, number: true, text: true, parentId: true },
  });
  // Each keyword gets an equal share, so an early keyword cannot crowd out a later one's
  // exceptions (four rules each still reach 702.19d).
  const perKeyword = Math.min(
    MAX_RULES_PER_CARD_KEYWORD,
    Math.max(4, Math.floor(MAX_CARD_KEYWORD_RULES / keywords.length)),
  );
  return keywords
    .flatMap((keyword) =>
      subrules
        .filter(({ parentId }) => parentId === keyword.id)
        .slice(0, perKeyword)
        .map((rule) => ({
          id: rule.id,
          number: rule.number,
          text: rule.text.slice(0, MAX_RULE_TEXT_CHARACTERS),
          parentNumber: keyword.number,
          includedBecause: "MATCH" as const,
          truncated: rule.text.length > MAX_RULE_TEXT_CHARACTERS,
        })),
    )
    .slice(0, MAX_CARD_KEYWORD_RULES);
}

/**
 * Adds the first subrules right after each searched rule whose text only introduces them
 * ("A player assigns a creature's combat damage according to the following rules:"), so the
 * packet holds the rule itself and not just its heading.
 */
export async function withSubrulesOfHeadings(
  rules: EvidenceSearchResponse["rules"],
  snapshotId: string,
  client: PrismaClient = prisma,
): Promise<EvidenceSearchResponse["rules"]> {
  // A rule cut for length can end in ":" by chance; only whole rules count as headings.
  const headings = rules
    .filter(
      (rule) =>
        !rule.truncated &&
        rule.text.trimEnd().endsWith(":") &&
        rule.text.length <= MAX_HEADING_RULE_CHARACTERS,
    )
    .slice(0, MAX_HEADINGS_EXPANDED);
  if (headings.length === 0) return rules;
  const children = await client.rule.findMany({
    where: { snapshotId, parentId: { in: headings.map(({ id }) => id) } },
    orderBy: { sortOrder: "asc" },
    select: { id: true, number: true, text: true, parentId: true },
  });
  const present = new Set(rules.map(({ id }) => id));
  const byParent = new Map<string, EvidenceSearchResponse["rules"]>();
  let room = MAX_SUBRULES_ADDED;
  for (const heading of headings) {
    const added = children
      .filter((child) => child.parentId === heading.id && !present.has(child.id))
      .slice(0, Math.min(MAX_SUBRULES_PER_HEADING, room));
    room -= added.length;
    byParent.set(
      heading.id,
      added.map((child) => ({
        id: child.id,
        number: child.number,
        text: child.text.slice(0, MAX_RULE_TEXT_CHARACTERS),
        parentNumber: heading.number,
        includedBecause: "REFERENCE" as const,
        truncated: child.text.length > MAX_RULE_TEXT_CHARACTERS,
      })),
    );
  }
  return rules.flatMap((rule) => [rule, ...(byParent.get(rule.id) ?? [])]);
}

/**
 * Searched rules followed by the core rules. A core rule the search also found is kept only as
 * CORE, so the prompt's core budget always includes it; as a searched rule it could fall past
 * the searched-rule cap.
 */
export function withCoreRules(
  searched: EvidenceSearchResponse["rules"],
  core: EvidenceSearchResponse["rules"],
): EvidenceSearchResponse["rules"] {
  const coreIds = new Set(core.map((rule) => rule.id));
  return [...searched.filter((rule) => !coreIds.has(rule.id)), ...core];
}

/**
 * Removes multi-word card names (whole, and before a comma, like "Sakashima of a Thousand
 * Faces") so their words are not searched as rules terms. Single-word names are kept: they are
 * either absent from the rules anyway or are rules words themselves ("Flash", "Fog", "Island").
 */
export function withoutCardNames(text: string, names: string[]): string {
  const variants = [
    ...new Set(
      names
        .flatMap((name) => [name, name.split(",")[0] ?? ""])
        .map((name) => name.trim())
        .filter((name) => /\s/.test(name)),
    ),
  ].sort((left, right) => right.length - left.length);
  return variants.reduce(
    (current, name) =>
      current.replace(
        new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"),
        " ",
      ),
    text,
  );
}

function takeText(
  text: string,
  perRecordLimit: number,
  budget: { remaining: number; truncated: boolean },
): { value: string; truncated: boolean } {
  const remaining = Math.max(0, Math.min(perRecordLimit, budget.remaining));
  const value = text.slice(0, remaining);
  const truncated = value.length < text.length;
  budget.remaining -= value.length;
  budget.truncated ||= truncated;
  return { value, truncated };
}

/** The printed characteristics the judge needs: cost, type, power/toughness, loyalty, defense. */
function faceCharacteristics(face: {
  manaCost: string;
  typeLine: string;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  defense: string | null;
}) {
  return {
    manaCost: face.manaCost,
    typeLine: face.typeLine,
    power: face.power,
    toughness: face.toughness,
    loyalty: face.loyalty,
    defense: face.defense,
  };
}
