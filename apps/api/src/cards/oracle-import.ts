import { createReadStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import type { PrismaClient } from "@prisma/client";
import { CardFaceRole, SnapshotStatus, SourceKind, type Prisma } from "@prisma/client";
import type { DownloadedOracleBulk } from "./source.js";

export interface OracleFaceInput {
  faceIndex: number;
  role: CardFaceRole;
  name: string;
  manaCost: string;
  typeLine: string;
  oracleText: string;
  power: string | null;
  toughness: string | null;
  imageUri: string | null;
}

export interface OracleCardInput {
  oracleId: string;
  name: string;
  layout: string;
  typeLine: string;
  oracleText: string;
  faces: OracleFaceInput[];
}

export interface OracleSnapshotWriter {
  activateOracleSnapshot(input: {
    version: string;
    sourceVersion: string;
    sourceUrl: string;
    sourcePublishedAt: Date;
    checksumSha256: string;
    importedAt: Date;
    cards: AsyncIterable<OracleCardInput>;
    minimumCardCount: number;
  }): Promise<{ id: string; version: string; cardCount: number }>;
}

export interface ImportOracleResult {
  checksumSha256: string;
  byteLength: number;
  cardCount: number;
  snapshot: { id: string; version: string };
}

const MAX_ORACLE_JSONL_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_ORACLE_RECORD_BYTES = 1024 * 1024;
// Increment when normalization changes so an unchanged source can be re-imported.
const ORACLE_IMPORTER_REVISION = 1;

export function normalizeOracleCard(value: unknown): OracleCardInput {
  if (!isRecord(value)) {
    throw new Error("Oracle bulk file contains a non-object card record.");
  }
  const oracleId = requireText(value.oracle_id, "oracle_id");
  const name = requireText(value.name, "name");
  const layout = requireText(value.layout, "layout");
  const hasPhysicalSides = [
    "transform",
    "modal_dfc",
    "double_faced_token",
    "reversible_card",
    "meld",
  ].includes(layout);
  const sourceFaces =
    Array.isArray(value.card_faces) && value.card_faces.length > 0 ? value.card_faces : [value];
  const faces = sourceFaces.map((sourceFace, faceIndex): OracleFaceInput => {
    if (!isRecord(sourceFace)) {
      throw new Error(`Card ${name} contains a malformed face.`);
    }
    const faceName = requireText(sourceFace.name ?? name, `face ${faceIndex} name`);
    return {
      faceIndex,
      role: !hasPhysicalSides
        ? CardFaceRole.OTHER
        : faceIndex === 0
          ? CardFaceRole.FRONT
          : faceIndex === 1
            ? CardFaceRole.BACK
            : CardFaceRole.OTHER,
      name: faceName,
      manaCost: optionalText(sourceFace.mana_cost),
      typeLine: optionalText(sourceFace.type_line ?? value.type_line),
      oracleText: optionalText(sourceFace.oracle_text ?? value.oracle_text),
      power: nullableText(sourceFace.power),
      toughness: nullableText(sourceFace.toughness),
      imageUri: findImageUri(sourceFace.image_uris) ?? findImageUri(value.image_uris),
    };
  });
  const topLevelTypeLine =
    optionalText(value.type_line) ||
    faces
      .map((face) => face.typeLine)
      .filter(Boolean)
      .join(" // ");
  const topLevelOracleText =
    optionalText(value.oracle_text) ||
    faces
      .map((face) => face.oracleText)
      .filter(Boolean)
      .join("\n\n//\n\n");

  return {
    oracleId,
    name,
    layout,
    typeLine: topLevelTypeLine,
    oracleText: topLevelOracleText,
    faces,
  };
}

export async function* readOracleCards(filePath: string): AsyncGenerator<OracleCardInput> {
  if (filePath.endsWith(".jsonl.gz")) {
    yield* readOracleJsonLines(filePath);
    return;
  }

  let arrayStarted = false;
  let arrayEnded = false;
  let afterObject = false;
  let afterComma = false;
  let objectDepth = 0;
  let inString = false;
  let escaped = false;
  let objectText = "";

  for await (const chunk of createReadStream(filePath, { encoding: "utf8" })) {
    const textChunk: string = String(chunk);
    for (const character of textChunk) {
      if (!arrayStarted) {
        if (/\s/.test(character)) continue;
        if (character !== "[") throw new Error("Oracle bulk file must contain a JSON array.");
        arrayStarted = true;
        continue;
      }
      if (arrayEnded) {
        if (!/\s/.test(character))
          throw new Error("Oracle bulk file contains content after its JSON array.");
        continue;
      }
      if (objectDepth === 0) {
        if (/\s/.test(character)) continue;
        if (afterObject && character === ",") {
          afterObject = false;
          afterComma = true;
          continue;
        }
        if (character === "]") {
          if (afterComma) throw new Error("Oracle bulk file contains a trailing array comma.");
          arrayEnded = true;
          continue;
        }
        if (character !== "{" || afterObject) {
          throw new Error("Oracle bulk file contains malformed array entries.");
        }
        objectDepth = 1;
        afterComma = false;
        objectText = "{";
        inString = false;
        escaped = false;
        continue;
      }

      objectText += character;
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === "{") objectDepth += 1;
      else if (character === "}") objectDepth -= 1;

      if (objectDepth === 0) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(objectText) as unknown;
        } catch {
          throw new Error("Oracle bulk file contains an invalid JSON card record.");
        }
        yield normalizeOracleCard(parsed);
        objectText = "";
        afterObject = true;
      }
    }
  }

  if (!arrayStarted || !arrayEnded || objectDepth !== 0) {
    throw new Error("Oracle bulk file ended before its JSON array was complete.");
  }
}

async function* readOracleJsonLines(filePath: string): AsyncGenerator<OracleCardInput> {
  const lines = createInterface({
    input: createReadStream(filePath).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  let totalBytes = 0;
  for await (const line of lines) {
    if (!line.trim()) continue;
    const lineBytes = Buffer.byteLength(line, "utf8");
    totalBytes += lineBytes;
    if (lineBytes > MAX_ORACLE_RECORD_BYTES) {
      throw new Error("Oracle JSONL bulk file contains a card record larger than 1 MiB.");
    }
    if (totalBytes > MAX_ORACLE_JSONL_BYTES) {
      throw new Error("Oracle JSONL bulk file exceeded the 2 GiB decompressed size limit.");
    }
    let record: unknown;
    try {
      record = JSON.parse(line) as unknown;
    } catch {
      throw new Error("Oracle JSONL bulk file contains an invalid card record.");
    }
    yield normalizeOracleCard(record);
  }
}

export async function importOracleBulk(
  download: DownloadedOracleBulk,
  writer: OracleSnapshotWriter,
  importedAt = new Date(),
  minimumCardCount = 1000,
): Promise<ImportOracleResult> {
  const datePart = download.metadata.updatedAt.toISOString().slice(0, 10).replaceAll("-", "");
  const version = `oracle-v${ORACLE_IMPORTER_REVISION}-${datePart}-${download.checksumSha256.slice(0, 12)}`;
  const result = await writer.activateOracleSnapshot({
    version,
    sourceVersion: download.metadata.updatedAt.toISOString(),
    sourceUrl: download.metadata.sourceUrl,
    sourcePublishedAt: download.metadata.updatedAt,
    checksumSha256: download.checksumSha256,
    importedAt,
    cards: readOracleCards(download.filePath),
    minimumCardCount,
  });
  return {
    checksumSha256: download.checksumSha256,
    byteLength: download.byteLength,
    cardCount: result.cardCount,
    snapshot: { id: result.id, version: result.version },
  };
}

export class PrismaOracleSnapshotWriter implements OracleSnapshotWriter {
  constructor(private readonly prisma: PrismaClient) {}

  async activateOracleSnapshot(
    input: Parameters<OracleSnapshotWriter["activateOracleSnapshot"]>[0],
  ) {
    return this.prisma.$transaction(
      async (transaction) => {
        const existing = await transaction.dataSnapshot.findUnique({
          where: { version: input.version },
          select: { id: true, version: true, status: true, _count: { select: { cards: true } } },
        });
        if (existing?.status === SnapshotStatus.ACTIVE) {
          return { id: existing.id, version: existing.version, cardCount: existing._count.cards };
        }
        if (existing) {
          throw new Error(`Snapshot version ${input.version} already exists but is not active.`);
        }

        const previous = await transaction.dataSnapshot.findFirst({
          where: { status: SnapshotStatus.ACTIVE },
          include: { sources: { where: { kind: SourceKind.COMPREHENSIVE_RULES } } },
        });
        const snapshotId = randomUUID();
        const now = input.importedAt;
        await transaction.dataSnapshot.create({
          data: {
            id: snapshotId,
            version: input.version,
            status: SnapshotStatus.CANDIDATE,
            createdAt: now,
          },
        });

        if (previous) {
          const rules = await transaction.rule.findMany({
            where: { snapshotId: previous.id },
            include: { referencesOut: true },
            orderBy: { sortOrder: "asc" },
          });
          const ruleIds = new Map(rules.map((rule) => [rule.id, randomUUID()]));
          if (rules.length > 0) {
            await transaction.rule.createMany({
              data: rules.map((rule) => ({
                id: ruleIds.get(rule.id)!,
                snapshotId,
                number: rule.number,
                text: rule.text,
                sortOrder: rule.sortOrder,
                parentId: rule.parentId ? ruleIds.get(rule.parentId)! : null,
              })),
            });
            const references: Prisma.RuleCrossReferenceCreateManyInput[] = rules.flatMap((rule) =>
              rule.referencesOut.flatMap((reference) => {
                const fromRuleId = ruleIds.get(reference.fromRuleId);
                const toRuleId = ruleIds.get(reference.toRuleId);
                return fromRuleId && toRuleId ? [{ id: randomUUID(), fromRuleId, toRuleId }] : [];
              }),
            );
            if (references.length > 0) {
              await transaction.ruleCrossReference.createMany({ data: references });
            }
          }
          const ruleSource = previous.sources[0];
          if (ruleSource) {
            await transaction.sourceSnapshot.create({
              data: {
                id: randomUUID(),
                snapshotId,
                kind: SourceKind.COMPREHENSIVE_RULES,
                sourceUrl: ruleSource.sourceUrl,
                sourceVersion: ruleSource.sourceVersion,
                sourcePublishedAt: ruleSource.sourcePublishedAt,
                importedAt: ruleSource.importedAt,
                checksumSha256: ruleSource.checksumSha256,
              },
            });
          }
        }

        await transaction.sourceSnapshot.create({
          data: {
            id: randomUUID(),
            snapshotId,
            kind: SourceKind.ORACLE_CARDS,
            sourceUrl: input.sourceUrl,
            sourceVersion: input.sourceVersion,
            sourcePublishedAt: input.sourcePublishedAt,
            importedAt: now,
            checksumSha256: input.checksumSha256,
          },
        });

        let cardCount = 0;
        let cardBatch: Array<{ card: OracleCardInput; cardId: string }> = [];
        const seenOracleIds = new Set<string>();
        const flushCards = async (): Promise<void> => {
          if (cardBatch.length === 0) return;
          await transaction.card.createMany({
            data: cardBatch.map(({ card, cardId }) => ({
              id: cardId,
              snapshotId,
              oracleId: card.oracleId,
              name: card.name,
              layout: card.layout,
              typeLine: card.typeLine,
              oracleText: card.oracleText,
            })),
          });
          await transaction.cardFace.createMany({
            data: cardBatch.flatMap(({ card, cardId }) =>
              card.faces.map((face) => ({ id: randomUUID(), cardId, ...face })),
            ),
          });
          cardBatch = [];
        };

        for await (const card of input.cards) {
          if (seenOracleIds.has(card.oracleId)) {
            throw new Error(`Oracle bulk file contains duplicate Oracle ID ${card.oracleId}.`);
          }
          seenOracleIds.add(card.oracleId);
          cardBatch.push({ card, cardId: randomUUID() });
          cardCount += 1;
          if (cardBatch.length >= 250) await flushCards();
        }
        await flushCards();

        if (cardCount < input.minimumCardCount) {
          throw new Error(
            `Oracle bulk file contained only ${cardCount} cards; expected at least ${input.minimumCardCount}.`,
          );
        }

        await transaction.dataSnapshot.updateMany({
          where: { status: SnapshotStatus.ACTIVE },
          data: { status: SnapshotStatus.RETIRED },
        });
        await transaction.dataSnapshot.update({
          where: { id: snapshotId },
          data: { status: SnapshotStatus.ACTIVE, activatedAt: now },
        });
        return { id: snapshotId, version: input.version, cardCount };
      },
      { isolationLevel: "Serializable", timeout: 120_000, maxWait: 10_000 },
    );
  }
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Oracle bulk card is missing ${label}.`);
  }
  return value.trim();
}

function optionalText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function findImageUri(value: unknown): string | null {
  if (!isRecord(value)) return null;
  for (const key of ["normal", "large", "small"]) {
    const uri = value[key];
    if (typeof uri === "string" && uri.startsWith("https://")) return uri;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
