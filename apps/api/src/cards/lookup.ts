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

type FaceMatch = Awaited<ReturnType<typeof loadFaces>>[number];

async function activeSnapshotId(client: PrismaClient): Promise<string | null> {
  const snapshot = await client.dataSnapshot.findFirst({
    where: { status: SnapshotStatus.ACTIVE },
    select: { id: true },
  });
  return snapshot?.id ?? null;
}

function toLookupResponse(matches: FaceMatch[], maxCards?: number): CardLookupResponse {
  const cards = new Map<string, CardLookupResponse["cards"][number]>();
  for (const match of matches) {
    if (cards.has(match.card.oracleId)) continue;
    if (maxCards !== undefined && cards.size >= maxCards) break;
    cards.set(match.card.oracleId, {
      oracleId: match.card.oracleId,
      name: match.card.name,
      layout: match.card.layout,
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
  return toLookupResponse(await findExactFaceMatches(name, snapshotId, client));
}

/**
 * Exact face-name matches when there are any; otherwise the closest names, so a typo
 * ("Lighning Bolt") or a partial name ("Jace") still finds candidates for the player to confirm.
 */
export async function lookupCardsByName(
  name: string,
  client: PrismaClient = prisma,
): Promise<CardLookupResponse> {
  const snapshotId = await activeSnapshotId(client);
  if (!snapshotId) return { cards: [] };
  const exact = await findExactFaceMatches(name, snapshotId, client);
  if (exact.length > 0) return toLookupResponse(exact);
  return toLookupResponse(
    await findApproximateFaceMatches(name, snapshotId, client),
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
  const faceIds = await client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT f."id"
    FROM "CardFace" AS f
    INNER JOIN "Card" AS c ON c."id" = f."cardId"
    WHERE c."snapshotId" = ${snapshotId}::uuid
      AND lower(f."name") = lower(${name})
    ORDER BY c."name" ASC, c."oracleId" ASC, f."faceIndex" ASC
    LIMIT ${limit ?? 2_147_483_647}
  `);
  if (faceIds.length === 0) return [];
  return loadFaces(
    faceIds.map(({ id }) => id),
    client,
  );
}

/**
 * Faces whose names are close to the input by trigram similarity (pg_trgm), best first. The
 * score is the better of whole-name similarity (typos) and word similarity (the input is part
 * of a longer name). Uses the trigram index on lower("name").
 */
export async function findApproximateFaceMatches(
  name: string,
  snapshotId: string,
  client: PrismaClient = prisma,
) {
  const query = name.trim().toLowerCase();
  if (query.length < 3) return [];
  const candidates = await client.$queryRaw<Array<{ id: string; score: number }>>(Prisma.sql`
    SELECT f."id",
      greatest(similarity(lower(f."name"), ${query}), word_similarity(${query}, lower(f."name")))
        AS score
    FROM "CardFace" AS f
    INNER JOIN "Card" AS c ON c."id" = f."cardId"
    WHERE c."snapshotId" = ${snapshotId}::uuid
      AND (lower(f."name") % ${query} OR ${query} <% lower(f."name"))
    ORDER BY score DESC, similarity(lower(f."name"), ${query}) DESC, length(f."name") ASC,
      c."oracleId" ASC, f."faceIndex" ASC
    LIMIT ${APPROXIMATE_FACE_CANDIDATES}
  `);
  const best = candidates[0]?.score ?? 0;
  const kept = candidates.filter(
    ({ score }) => score >= MIN_APPROXIMATE_SCORE && score >= best - APPROXIMATE_SCORE_WINDOW,
  );
  if (kept.length === 0) return [];
  return loadFaces(
    kept.map(({ id }) => id),
    client,
  );
}
