import { Prisma, SnapshotStatus, type PrismaClient } from "@prisma/client";
import type { CardLookupResponse } from "@mtg-rules/contracts";
import { prisma } from "../db/client.js";

export async function lookupCardsByExactFaceName(name: string): Promise<CardLookupResponse> {
  const activeSnapshot = await prisma.dataSnapshot.findFirst({
    where: { status: SnapshotStatus.ACTIVE },
    select: { id: true },
  });
  if (!activeSnapshot) return { cards: [] };

  const matchingFaces = await findExactFaceMatches(name, activeSnapshot.id);

  const cards = new Map<string, CardLookupResponse["cards"][number]>();
  for (const match of matchingFaces) {
    if (!cards.has(match.card.oracleId)) {
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
  }
  return { cards: [...cards.values()] };
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
  const matches = await client.cardFace.findMany({
    where: { id: { in: faceIds.map(({ id }) => id) } },
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
  return faceIds.flatMap(({ id }) => {
    const match = matchesById.get(id);
    return match ? [match] : [];
  });
}
