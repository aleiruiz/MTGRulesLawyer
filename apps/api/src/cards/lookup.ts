import { SnapshotStatus } from "@prisma/client";
import type { CardLookupResponse } from "@mtg-rules/contracts";
import { prisma } from "../db/client.js";

export async function lookupCardsByExactFaceName(name: string): Promise<CardLookupResponse> {
  const activeSnapshot = await prisma.dataSnapshot.findFirst({
    where: { status: SnapshotStatus.ACTIVE },
    select: { id: true },
  });
  if (!activeSnapshot) return { cards: [] };

  const matchingFaces = await prisma.cardFace.findMany({
    where: {
      name: { equals: name, mode: "insensitive" },
      card: { snapshotId: activeSnapshot.id },
    },
    include: {
      card: {
        select: {
          oracleId: true,
          name: true,
          layout: true,
          faces: { orderBy: { faceIndex: "asc" } },
        },
      },
    },
    orderBy: [{ card: { name: "asc" } }, { faceIndex: "asc" }],
  });

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
