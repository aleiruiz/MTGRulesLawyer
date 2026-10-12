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
const MAX_EXPANDED_RULES = 24;
const MAX_REFERENCES_PER_RULE = 12;
const MAX_CARDS_PER_NAME = 3;
const MAX_EVIDENCE_CARDS = MAX_CONFIRMED_CARDS;
const MAX_CARD_EVIDENCE_CHARACTERS = 8_000;
const MAX_RULE_EVIDENCE_CHARACTERS = 16_000;
const MAX_RULE_TEXT_CHARACTERS = 6_000;
const MAX_CARD_TEXT_CHARACTERS = 2_000;
const RULE_NUMBER = /\b\d{3}(?:\.\d+[a-z]?)?\b/gi;

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
        };
      });
      const matchedFace = faces.find((face) => face.id === match.id);
      if (!matchedFace) continue;
      cards.push({
        id: card.id,
        oracleId: card.oracleId,
        name: card.name,
        layout: card.layout,
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
  const fullTextHits = await client.$queryRaw<Array<{ id: string; number: string }>>(Prisma.sql`
    WITH snapshot_rules AS (
      SELECT r."id", r."number", r."sortOrder", to_tsvector('english', r."text") AS document
      FROM "Rule" AS r
      WHERE r."snapshotId" = ${snapshot.id}::uuid
    ),
    question_terms AS (
      SELECT term.lexeme
      FROM unnest(to_tsvector('english', ${request.question})) AS term
      ORDER BY term.positions[1]
      LIMIT ${MAX_QUERY_TERMS}
    ),
    term_frequency AS (
      SELECT question_terms.lexeme,
        (SELECT count(*) FROM snapshot_rules
          WHERE snapshot_rules.document @@ quote_literal(question_terms.lexeme)::tsquery) AS rules
      FROM question_terms
    ),
    query AS (
      SELECT string_agg(quote_literal(rare.lexeme), ' | ')::tsquery AS terms
      FROM (
        SELECT term_frequency.lexeme
        FROM term_frequency
        WHERE term_frequency.rules > 0
          AND term_frequency.rules <= GREATEST(
            (SELECT count(*) FROM snapshot_rules) * ${MAX_TERM_RULE_SHARE},
            ${MIN_COMMON_TERM_RULES}
          )
        ORDER BY term_frequency.rules ASC
        LIMIT ${MAX_RANKING_TERMS}
      ) AS rare
    )
    SELECT snapshot_rules."id", snapshot_rules."number"
    FROM snapshot_rules, query
    WHERE snapshot_rules.document @@ query.terms
    ORDER BY ts_rank_cd(snapshot_rules.document, query.terms, 1) DESC,
      snapshot_rules."sortOrder" ASC
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
        include: { faces: { orderBy: { faceIndex: "asc" } } },
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
  const query = [
    ...request.gameState.searchTerms,
    request.question,
    ...request.gameState.events,
    ...request.gameState.knownFacts,
    ...request.gameState.missingFacts,
  ]
    .join("\n")
    .slice(0, 4_000);
  const packet = await assembleEvidence({ question: query, cardNames: [] }, client, snapshot.id);
  const cardBudget = { remaining: MAX_CARD_EVIDENCE_CHARACTERS, truncated: false };
  const cards: EvidenceSearchResponse["cards"] = selectedCards.map(({ card, face, quantity }) => {
    const faces = card.faces.map((cardFace) => {
      const faceText = takeText(cardFace.oracleText, MAX_CARD_TEXT_CHARACTERS, cardBudget);
      return {
        id: cardFace.id,
        faceIndex: cardFace.faceIndex,
        role: cardFace.role,
        name: cardFace.name,
        oracleText: faceText.value,
        truncated: faceText.truncated,
      };
    });
    const matchedFace = faces.find(({ id }) => id === face.id);
    if (!matchedFace) throw new InvalidConfirmedCardsError();
    return {
      id: card.id,
      oracleId: card.oracleId,
      name: card.name,
      layout: card.layout,
      selectedFaceIndex: face.faceIndex,
      quantity,
      matchedFace,
      faces,
    };
  });

  return evidenceSearchResponseSchema.parse({
    ...packet,
    cards,
    truncated: packet.truncated || cardBudget.truncated,
  });
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
