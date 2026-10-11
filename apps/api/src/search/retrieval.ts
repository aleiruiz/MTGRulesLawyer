import { Prisma, SnapshotStatus, type PrismaClient } from "@prisma/client";
import {
  evidenceSearchRequestSchema,
  evidenceSearchResponseSchema,
  type EvidenceSearchRequest,
  type EvidenceSearchResponse,
} from "@mtg-rules/contracts";
import { findExactFaceMatches } from "../cards/lookup.js";
import { prisma } from "../db/client.js";

const MAX_MATCHING_RULES = 8;
const MAX_EXPANDED_RULES = 24;
const MAX_REFERENCES_PER_RULE = 12;
const MAX_CARDS_PER_NAME = 3;
const MAX_EVIDENCE_CARDS = 8;
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
): Promise<EvidenceSearchResponse> {
  const request = evidenceSearchRequestSchema.parse(input);
  const snapshot = await client.dataSnapshot.findFirst({
    where: { status: SnapshotStatus.ACTIVE },
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
  const fullTextHits = await client.$queryRaw<Array<{ id: string; number: string }>>(Prisma.sql`
    SELECT r."id", r."number"
    FROM "Rule" AS r
    WHERE r."snapshotId" = ${snapshot.id}::uuid
      AND to_tsvector('english', r."text") @@ websearch_to_tsquery('english', ${request.question})
    ORDER BY ts_rank_cd(to_tsvector('english', r."text"), websearch_to_tsquery('english', ${request.question})) DESC,
      r."sortOrder" ASC
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
