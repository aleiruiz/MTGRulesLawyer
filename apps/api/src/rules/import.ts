import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { SnapshotStatus, SourceKind } from "@prisma/client";

export const RULES_SOURCE_PAGE = "https://magic.wizards.com/en/rules";
const RULES_DOCUMENT_START = "1. Game Concepts";
const RULES_DOCUMENT_END = "Glossary";
const REQUIRED_RULE_SECTIONS = [100, 200, 300, 400, 500, 600, 700, 800, 900];
const RULE_LINE = /^(\d{3}(?:\.\d+[a-z]?)?)(?:\.\s+|\s+)(.+?)\s*$/i;
const RULE_REFERENCE = /\b\d{3}(?:\.\d+[a-z]?)?\b/gi;

export interface ParsedRule {
  number: string;
  text: string;
  sortOrder: number;
  parentNumber: string | null;
  references: string[];
}

export interface ParsedRulesDocument {
  effectiveAt: Date;
  rules: ParsedRule[];
}

export interface RulesSnapshotInput {
  version: string;
  sourceUrl: string;
  sourcePublishedAt: Date;
  checksumSha256: string;
  rules: ParsedRule[];
  importedAt: Date;
}

export interface RulesSnapshotWriter {
  activateRulesSnapshot(input: RulesSnapshotInput): Promise<{ id: string; version: string }>;
}

export interface ImportRulesResult {
  checksumSha256: string;
  ruleCount: number;
  snapshot: { id: string; version: string };
}

export function parseRulesDocument(input: string, minimumRuleCount = 1000): ParsedRulesDocument {
  const normalized = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const effectiveDateMatch = normalized.match(/effective as of\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i);
  if (!effectiveDateMatch) {
    throw new Error("Rules document does not contain a valid effective date.");
  }

  const lines = normalized.split("\n");
  const contentsEndIndex = lines.findIndex((line) => line.trim() === "Credits");
  const startIndex = lines.findIndex(
    (line, index) => index > contentsEndIndex && line.trim() === RULES_DOCUMENT_START,
  );
  if (startIndex < 0) {
    throw new Error("Rules document body was not found.");
  }
  const endIndex = lines.findIndex(
    (line, index) => index > startIndex && line.trim() === RULES_DOCUMENT_END,
  );
  if (endIndex < 0) {
    throw new Error("Rules document glossary terminator was not found.");
  }

  const rules: ParsedRule[] = [];
  let currentNumber: string | undefined;
  let currentLines: string[] = [];
  const flushRule = (): void => {
    if (currentNumber === undefined) {
      return;
    }

    const ruleText = currentLines.join("\n").trim();
    if (!ruleText) {
      throw new Error(`Rule ${currentNumber} has no text.`);
    }

    rules.push({
      number: currentNumber,
      text: ruleText,
      sortOrder: rules.length,
      parentNumber: getParentNumber(currentNumber),
      references: extractRuleReferences(ruleText),
    });
  };

  for (const line of lines.slice(startIndex + 1, endIndex)) {
    const match = line.match(RULE_LINE);
    if (match) {
      flushRule();
      currentNumber = match[1];
      currentLines = [match[2]];
    } else if (currentNumber !== undefined) {
      currentLines.push(line);
    }
  }
  flushRule();

  if (rules.length < minimumRuleCount) {
    throw new Error(
      `Rules document contained only ${rules.length} numbered sections; expected at least ${minimumRuleCount}.`,
    );
  }

  const rulesByNumber = new Map(rules.map((rule) => [rule.number, rule]));
  if (rulesByNumber.size !== rules.length) {
    throw new Error("Rules document contains duplicate rule numbers.");
  }

  const missingSections = REQUIRED_RULE_SECTIONS.filter(
    (section) => !rulesByNumber.has(String(section)),
  );
  if (missingSections.length > 0) {
    throw new Error(`Rules document is missing expected sections: ${missingSections.join(", ")}.`);
  }

  for (const rule of rules) {
    if (rule.parentNumber && !rulesByNumber.has(rule.parentNumber)) {
      throw new Error(`Rule ${rule.number} is missing parent ${rule.parentNumber}.`);
    }
    const missingReference = rule.references.find((reference) => !rulesByNumber.has(reference));
    if (missingReference) {
      throw new Error(`Rule ${rule.number} references missing rule ${missingReference}.`);
    }
  }

  const effectiveAt = new Date(`${effectiveDateMatch[1]} UTC`);
  if (Number.isNaN(effectiveAt.getTime())) {
    throw new Error("Rules document contains an invalid effective date.");
  }

  return { effectiveAt, rules };
}

export async function importRulesText(
  text: string,
  sourceUrl: string,
  writer: RulesSnapshotWriter,
  importedAt = new Date(),
): Promise<ImportRulesResult> {
  const parsed = parseRulesDocument(text);
  const checksumSha256 = createHash("sha256").update(text, "utf8").digest("hex");
  const datePart = parsed.effectiveAt.toISOString().slice(0, 10).replaceAll("-", "");
  const version = `rules-${datePart}-${checksumSha256.slice(0, 12)}`;
  const snapshot = await writer.activateRulesSnapshot({
    version,
    sourceUrl,
    sourcePublishedAt: parsed.effectiveAt,
    checksumSha256,
    rules: parsed.rules,
    importedAt,
  });

  return { checksumSha256, ruleCount: parsed.rules.length, snapshot };
}

export class PrismaRulesSnapshotWriter implements RulesSnapshotWriter {
  constructor(private readonly prisma: PrismaClient) {}

  async activateRulesSnapshot(input: RulesSnapshotInput): Promise<{ id: string; version: string }> {
    assertValidRulesInput(input);
    return this.prisma.$transaction(
      async (transaction) => {
        const active = await transaction.dataSnapshot.findFirst({
          where: { status: SnapshotStatus.ACTIVE },
          include: { sources: true },
        });
        const activeRulesSource = active?.sources.find(
          (source) => source.kind === SourceKind.COMPREHENSIVE_RULES,
        );
        if (active && activeRulesSource?.checksumSha256 === input.checksumSha256) {
          return { id: active.id, version: active.version };
        }

        const existing = await transaction.dataSnapshot.findUnique({
          where: { version: input.version },
          select: { id: true, version: true, status: true },
        });
        if (existing?.status === SnapshotStatus.ACTIVE) {
          return { id: existing.id, version: existing.version };
        }
        if (existing) {
          throw new Error(`Snapshot version ${input.version} already exists but is not active.`);
        }

        const ruleIds = new Map(input.rules.map((rule) => [rule.number, randomUUID()]));
        const snapshotId = randomUUID();
        const sourceId = randomUUID();

        await transaction.dataSnapshot.create({
          data: {
            id: snapshotId,
            version: input.version,
            status: SnapshotStatus.CANDIDATE,
            activatedAt: null,
            notes: active?.notes ?? null,
            createdAt: input.importedAt,
          },
        });
        await transaction.sourceSnapshot.create({
          data: {
            id: sourceId,
            snapshotId,
            kind: SourceKind.COMPREHENSIVE_RULES,
            sourceUrl: input.sourceUrl,
            sourceVersion: input.version,
            sourcePublishedAt: input.sourcePublishedAt,
            importedAt: input.importedAt,
            checksumSha256: input.checksumSha256,
          },
        });
        await transaction.rule.createMany({
          data: input.rules.map((rule) => ({
            id: ruleIds.get(rule.number)!,
            snapshotId,
            number: rule.number,
            text: rule.text,
            sortOrder: rule.sortOrder,
            parentId: rule.parentNumber ? ruleIds.get(rule.parentNumber)! : null,
          })),
        });

        const references: Prisma.RuleCrossReferenceCreateManyInput[] = [];
        for (const rule of input.rules) {
          const fromRuleId = ruleIds.get(rule.number)!;
          for (const targetNumber of rule.references) {
            const toRuleId = ruleIds.get(targetNumber);
            if (toRuleId && fromRuleId !== toRuleId) {
              references.push({ id: randomUUID(), fromRuleId, toRuleId });
            }
          }
        }
        if (references.length > 0) {
          await transaction.ruleCrossReference.createMany({
            data: references,
            skipDuplicates: true,
          });
        }

        // A rules refresh must carry forward the active Oracle corpus. Both datasets
        // belong to the same immutable snapshot used by new rulings.
        const oracleSource = active?.sources.find(
          (source) => source.kind === SourceKind.ORACLE_CARDS,
        );
        const cardCount = active
          ? await transaction.card.count({ where: { snapshotId: active.id } })
          : 0;
        const faceCount = active
          ? await transaction.cardFace.count({ where: { card: { snapshotId: active.id } } })
          : 0;
        if (active && oracleSource) {
          await transaction.sourceSnapshot.create({
            data: {
              id: randomUUID(),
              snapshotId,
              kind: SourceKind.ORACLE_CARDS,
              sourceUrl: oracleSource.sourceUrl,
              sourceVersion: oracleSource.sourceVersion,
              sourcePublishedAt: oracleSource.sourcePublishedAt,
              importedAt: oracleSource.importedAt,
              checksumSha256: oracleSource.checksumSha256,
            },
          });
          await copyCards(transaction, active.id, snapshotId);
        }

        const [candidateRuleCount, candidateCardCount, candidateFaceCount, candidateSources] =
          await Promise.all([
            transaction.rule.count({ where: { snapshotId } }),
            transaction.card.count({ where: { snapshotId } }),
            transaction.cardFace.count({ where: { card: { snapshotId } } }),
            transaction.sourceSnapshot.findMany({ where: { snapshotId } }),
          ]);
        if (
          candidateRuleCount !== input.rules.length ||
          candidateCardCount !== (oracleSource ? cardCount : 0) ||
          candidateFaceCount !== (oracleSource ? faceCount : 0) ||
          !candidateSources.some((source) => source.kind === SourceKind.COMPREHENSIVE_RULES) ||
          (oracleSource &&
            !candidateSources.some((source) => source.kind === SourceKind.ORACLE_CARDS))
        ) {
          throw new Error("Rules snapshot candidate failed count or source validation.");
        }

        await transaction.dataSnapshot.updateMany({
          where: { status: SnapshotStatus.ACTIVE },
          data: { status: SnapshotStatus.RETIRED },
        });
        await transaction.dataSnapshot.update({
          where: { id: snapshotId },
          data: { status: SnapshotStatus.ACTIVE, activatedAt: input.importedAt },
        });

        return { id: snapshotId, version: input.version };
      },
      { isolationLevel: "Serializable", timeout: 120_000, maxWait: 10_000 },
    );
  }
}

function assertValidRulesInput(input: RulesSnapshotInput): void {
  const numbers = new Set(input.rules.map((rule) => rule.number));
  if (numbers.size !== input.rules.length || input.rules.length === 0) {
    throw new Error("Rules snapshot candidate must contain unique numbered rules.");
  }
  for (const rule of input.rules) {
    if (
      (rule.parentNumber && !numbers.has(rule.parentNumber)) ||
      rule.references.some((reference) => !numbers.has(reference))
    ) {
      throw new Error(
        `Rules snapshot candidate contains unresolved references in rule ${rule.number}.`,
      );
    }
  }
}

async function copyCards(
  transaction: Prisma.TransactionClient,
  fromSnapshotId: string,
  toSnapshotId: string,
): Promise<void> {
  const pageSize = 500;
  let cursor: string | undefined;
  while (true) {
    const cards = await transaction.card.findMany({
      where: { snapshotId: fromSnapshotId },
      orderBy: { id: "asc" },
      take: pageSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { faces: { orderBy: { faceIndex: "asc" } } },
    });
    if (cards.length === 0) return;
    const cardIds = new Map(cards.map((card) => [card.id, randomUUID()]));
    await transaction.card.createMany({
      data: cards.map((card) => ({
        id: cardIds.get(card.id)!,
        snapshotId: toSnapshotId,
        oracleId: card.oracleId,
        name: card.name,
        layout: card.layout,
        typeLine: card.typeLine,
        oracleText: card.oracleText,
      })),
    });
    await transaction.cardFace.createMany({
      data: cards.flatMap((card) =>
        card.faces.map((face) => ({
          id: randomUUID(),
          cardId: cardIds.get(card.id)!,
          faceIndex: face.faceIndex,
          role: face.role,
          name: face.name,
          manaCost: face.manaCost,
          typeLine: face.typeLine,
          oracleText: face.oracleText,
          power: face.power,
          toughness: face.toughness,
          imageUri: face.imageUri,
        })),
      ),
    });
    cursor = cards[cards.length - 1].id;
  }
}

function getParentNumber(number: string): string | null {
  const letterParent = number.match(/^(\d{3}\.\d+)[a-z]$/i);
  if (letterParent) {
    return letterParent[1];
  }

  const lastDot = number.lastIndexOf(".");
  return lastDot >= 0 ? number.slice(0, lastDot) : null;
}

function extractRuleReferences(text: string): string[] {
  const references = new Set<string>();
  const keywordPattern = /\b(?:rules?|subrules?)\s+/gi;
  while (keywordPattern.exec(text) !== null) {
    let cursor = keywordPattern.lastIndex;
    const firstReference = RULE_REFERENCE.exec(text.slice(cursor));
    RULE_REFERENCE.lastIndex = 0;
    if (!firstReference || firstReference.index !== 0) {
      continue;
    }
    references.add(firstReference[0]);
    cursor += firstReference[0].length;

    while (cursor < text.length) {
      const separator = text.slice(cursor).match(/^\s*(?:,|and|or|to|through|[-–—])\s*/i);
      if (!separator) {
        break;
      }
      cursor += separator[0].length;

      const continuation = text.slice(cursor).match(/^\d{3}(?:\.\d+[a-z]?)?/i);
      if (continuation) {
        references.add(continuation[0]);
        cursor += continuation[0].length;
        continue;
      }

      const letterRange = text.slice(cursor).match(/^([a-z])\b/i);
      const previous = [...references].at(-1);
      const previousParts = previous?.match(/^(\d{3}\.\d+)([a-z])$/i);
      if (letterRange && previousParts) {
        const start = previousParts[2].toLowerCase().charCodeAt(0);
        const end = letterRange[1].toLowerCase().charCodeAt(0);
        for (let code = start + 1; code <= end; code += 1) {
          const suffix = String.fromCharCode(code);
          // Comprehensive Rules subrule letters skip l and o to avoid confusion with 1 and 0.
          if (suffix !== "l" && suffix !== "o") {
            references.add(`${previousParts[1]}${suffix}`);
          }
        }
        cursor += letterRange[0].length;
        continue;
      }
      break;
    }
  }

  return [...references];
}
