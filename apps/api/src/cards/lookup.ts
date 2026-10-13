import { Prisma, SnapshotStatus, type PrismaClient } from "@prisma/client";
import type { CardLookupResponse } from "@mtg-rules/contracts";
import { prisma } from "../db/client.js";

/** Most cards an approximate lookup offers; the player picks among them. */
export const MAX_APPROXIMATE_CARDS = 8;
// Approximate matches keep only names nearly as close as the best one, so "Lighning Bolt"
// offers Lightning Bolt rather than every other "... Bolt".
const APPROXIMATE_SCORE_WINDOW = 0.1;
const MIN_APPROXIMATE_SCORE = 0.45;
// Faces read before grouping by card; several cards can share a face name.
const APPROXIMATE_FACE_CANDIDATES = 40;
const MAX_APPROXIMATE_INPUT_CHARACTERS = 60;
const MAX_APPROXIMATE_INPUT_WORDS = 6;
const APPROXIMATE_TIMEOUT_MS = 1_000;
// Edit-distance fallback for typos trigrams miss ("Tormagoyf"): about one edit per four
// letters, so short names stay strict.
const LETTERS_PER_EDIT = 4;
const MAX_NAME_EDITS = 3;

type FaceMatch = Awaited<ReturnType<typeof loadFaces>>[number];

async function activeSnapshotId(client: PrismaClient): Promise<string | null> {
  const snapshot = await client.dataSnapshot.findFirst({
    where: { status: SnapshotStatus.ACTIVE },
    select: { id: true },
  });
  return snapshot?.id ?? null;
}

function toLookupResponse(
  matches: FaceMatch[],
  matchKind: "exact" | "approximate",
  maxCards?: number,
): CardLookupResponse {
  const cards = new Map<string, CardLookupResponse["cards"][number]>();
  for (const match of matches) {
    if (cards.has(match.card.oracleId)) continue;
    if (maxCards !== undefined && cards.size >= maxCards) break;
    cards.set(match.card.oracleId, {
      oracleId: match.card.oracleId,
      name: match.card.name,
      layout: match.card.layout,
      matchKind,
      matchedFace: {
        faceIndex: match.faceIndex,
        role: match.role,
        name: match.name,
        manaCost: match.manaCost,
        typeLine: match.typeLine,
        oracleText: match.oracleText,
        power: match.power,
        toughness: match.toughness,
        imageUri: match.imageUri,
      },
      faces: match.card.faces.map((face) => ({
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
    });
  }
  return { cards: [...cards.values()] };
}

export async function lookupCardsByExactFaceName(
  name: string,
  client: PrismaClient = prisma,
): Promise<CardLookupResponse> {
  const snapshotId = await activeSnapshotId(client);
  if (!snapshotId) return { cards: [] };
  return toLookupResponse(await findExactFaceMatches(name, snapshotId, client), "exact");
}

/**
 * Exact face-name matches when there are any; otherwise the closest names, so a typo
 * ("Lighning Bolt") or a partial name ("Jace") still finds candidates for the player to confirm.
 */
export async function lookupCardsByName(
  name: string,
  client: PrismaClient = prisma,
  /** Defaults to the active snapshot. */
  snapshot?: string,
): Promise<CardLookupResponse> {
  const snapshotId = snapshot ?? (await activeSnapshotId(client));
  if (!snapshotId) return { cards: [] };
  const exact = await findExactFaceMatches(name, snapshotId, client);
  if (exact.length > 0) return toLookupResponse(exact, "exact");
  return toLookupResponse(
    await findApproximateFaceMatches(name, snapshotId, client),
    "approximate",
    MAX_APPROXIMATE_CARDS,
  );
}

async function loadFaces(faceIds: string[], client: PrismaClient) {
  const matches = await client.cardFace.findMany({
    where: { id: { in: faceIds } },
    include: {
      card: {
        select: {
          id: true,
          oracleId: true,
          name: true,
          layout: true,
          manaValue: true,
          snapshotId: true,
          faces: { orderBy: { faceIndex: "asc" } },
        },
      },
    },
  });
  const matchesById = new Map(matches.map((match) => [match.id, match]));
  return faceIds.flatMap((id) => {
    const match = matchesById.get(id);
    return match ? [match] : [];
  });
}

export async function findExactFaceMatches(
  name: string,
  snapshotId: string,
  client: PrismaClient = prisma,
  limit?: number,
) {
  // English Oracle face names, plus printed names in other languages ("Elfos de Llanowar").
  const faceIds = await client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT matches."id"
    FROM (
      SELECT f."id", c."name" AS "cardName", c."oracleId", f."faceIndex"
      FROM "CardFace" AS f
      INNER JOIN "Card" AS c ON c."id" = f."cardId"
      WHERE c."snapshotId" = ${snapshotId}::uuid
        AND lower(f."name") = lower(${name})
      UNION
      SELECT f."id", c."name" AS "cardName", c."oracleId", f."faceIndex"
      FROM "CardLocalizedName" AS l
      INNER JOIN "Card" AS c ON c."oracleId" = l."oracleId" AND c."snapshotId" = ${snapshotId}::uuid
      INNER JOIN "CardFace" AS f ON f."cardId" = c."id" AND f."faceIndex" = l."faceIndex"
      WHERE lower(l."name") = lower(${name})
    ) AS matches
    ORDER BY matches."cardName" ASC, matches."oracleId" ASC, matches."faceIndex" ASC
    LIMIT ${limit ?? 2_147_483_647}
  `);
  if (faceIds.length === 0) return [];
  return loadFaces(
    faceIds.map(({ id }) => id),
    client,
  );
}

/**
 * Faces whose names (English or printed in another language) are close to the input by
 * trigram similarity (pg_trgm), best first. The score is the better of whole-name similarity
 * (typos) and word similarity (the input is part of a longer name). Uses the trigram indexes
 * on lower("name").
 */
export async function findApproximateFaceMatches(
  name: string,
  snapshotId: string,
  client: PrismaClient = prisma,
) {
  const query = name.trim().replace(/\s+/g, " ").toLowerCase();
  // Card names are short. Long or many-word input is not a name, and common short words in
  // it make trigram matching scan most faces, so it gets no approximate pass.
  if (
    query.length < 3 ||
    query.length > MAX_APPROXIMATE_INPUT_CHARACTERS ||
    query.split(" ").length > MAX_APPROXIMATE_INPUT_WORDS
  )
    return [];
  const [, , candidates] = await client.$transaction([
    // Supabase installs extensions in the "extensions" schema; Postgres ignores missing schemas.
    client.$executeRaw`SET LOCAL search_path = public, extensions`,
    client.$executeRaw`SET LOCAL statement_timeout = ${Prisma.raw(String(APPROXIMATE_TIMEOUT_MS))}`,
    // Scores each face by its English name or, when closer, one of its printed names in
    // another language, so a misspelled Spanish name still finds the card.
    client.$queryRaw<Array<{ id: string; score: number }>>(Prisma.sql`
    SELECT matches."id", max(matches."score") AS score
    FROM (
      SELECT f."id", c."oracleId", f."faceIndex", length(f."name") AS "nameLength",
        greatest(similarity(lower(f."name"), ${query}), word_similarity(${query}, lower(f."name")))
          AS score,
        similarity(lower(f."name"), ${query}) AS "wholeScore"
      FROM "CardFace" AS f
      INNER JOIN "Card" AS c ON c."id" = f."cardId"
      WHERE c."snapshotId" = ${snapshotId}::uuid
        AND (lower(f."name") % ${query} OR ${query} <% lower(f."name"))
      UNION ALL
      SELECT f."id", c."oracleId", f."faceIndex", length(l."name") AS "nameLength",
        greatest(similarity(lower(l."name"), ${query}), word_similarity(${query}, lower(l."name")))
          AS score,
        similarity(lower(l."name"), ${query}) AS "wholeScore"
      FROM "CardLocalizedName" AS l
      INNER JOIN "Card" AS c ON c."oracleId" = l."oracleId" AND c."snapshotId" = ${snapshotId}::uuid
      INNER JOIN "CardFace" AS f ON f."cardId" = c."id" AND f."faceIndex" = l."faceIndex"
      WHERE lower(l."name") % ${query} OR ${query} <% lower(l."name")
    ) AS matches
    GROUP BY matches."id", matches."oracleId", matches."faceIndex"
    ORDER BY score DESC, max(matches."wholeScore") DESC, min(matches."nameLength") ASC,
      matches."oracleId" ASC, matches."faceIndex" ASC
    LIMIT ${APPROXIMATE_FACE_CANDIDATES}
  `),
  ]);
  const best = candidates[0]?.score ?? 0;
  const kept = candidates.filter(
    ({ score }) => score >= MIN_APPROXIMATE_SCORE && score >= best - APPROXIMATE_SCORE_WINDOW,
  );
  const ids =
    kept.length > 0
      ? kept.map(({ id }) => id)
      : await findFacesByEditDistance(query, snapshotId, client);
  if (ids.length === 0) return [];
  return loadFaces(ids, client);
}

/**
 * Faces whose names (English or printed in another language) are within a few edits of the
 * input, fewest edits first. Only names of about the same length are compared.
 */
async function findFacesByEditDistance(
  query: string,
  snapshotId: string,
  client: PrismaClient,
): Promise<string[]> {
  const edits = Math.min(MAX_NAME_EDITS, Math.max(1, Math.floor(query.length / LETTERS_PER_EDIT)));
  const [, , matches] = await client.$transaction([
    client.$executeRaw`SET LOCAL search_path = public, extensions`,
    client.$executeRaw`SET LOCAL statement_timeout = ${Prisma.raw(String(APPROXIMATE_TIMEOUT_MS))}`,
    client.$queryRaw<Array<{ id: string; distance: number }>>(Prisma.sql`
    SELECT matches."id", min(matches."distance") AS distance
    FROM (
      SELECT f."id", c."oracleId", f."faceIndex",
        levenshtein_less_equal(lower(f."name"), ${query}, ${edits}::int) AS distance
      FROM "CardFace" AS f
      INNER JOIN "Card" AS c ON c."id" = f."cardId"
      WHERE c."snapshotId" = ${snapshotId}::uuid
        AND abs(length(f."name") - ${query.length}) <= ${edits}
      UNION ALL
      SELECT f."id", c."oracleId", f."faceIndex",
        levenshtein_less_equal(lower(l."name"), ${query}, ${edits}::int) AS distance
      FROM "CardLocalizedName" AS l
      INNER JOIN "Card" AS c ON c."oracleId" = l."oracleId" AND c."snapshotId" = ${snapshotId}::uuid
      INNER JOIN "CardFace" AS f ON f."cardId" = c."id" AND f."faceIndex" = l."faceIndex"
      WHERE abs(length(l."name") - ${query.length}) <= ${edits}
    ) AS matches
    GROUP BY matches."id", matches."oracleId", matches."faceIndex"
    HAVING min(matches."distance") <= ${edits}
    ORDER BY distance ASC, matches."oracleId" ASC, matches."faceIndex" ASC
    LIMIT ${APPROXIMATE_FACE_CANDIDATES}
  `),
  ]);
  // Only the closest names, as with the trigram pass.
  const closest = matches[0]?.distance;
  return matches.filter(({ distance }) => distance === closest).map(({ id }) => id);
}
