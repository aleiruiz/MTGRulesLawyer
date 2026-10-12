import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient, SnapshotStatus } from "@prisma/client";
import { after, describe, it } from "node:test";
import { findApproximateFaceMatches, findExactFaceMatches, lookupCardsByName } from "./lookup.js";

const enabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === "true";
const prisma = new PrismaClient();

void after(async () => prisma.$disconnect());

void describe("Approximate card lookup integration", { skip: !enabled }, () => {
  void it("finds cards from typos and partial names but prefers the closest names", async () => {
    // A candidate snapshot keeps the fixture out of the active data.
    const snapshot = await prisma.dataSnapshot.create({
      data: { version: `lookup-${randomUUID()}`, status: SnapshotStatus.CANDIDATE },
    });
    try {
      for (const name of ["Lightning Bolt", "Guiding Bolt", "Grizzly Bears", "Jace Beleren"]) {
        await prisma.card.create({
          data: {
            snapshotId: snapshot.id,
            oracleId: `${name}-${randomUUID()}`,
            name,
            layout: "normal",
            faces: { create: { faceIndex: 0, name } },
          },
        });
      }
      const names = async (query: string) =>
        (await findApproximateFaceMatches(query, snapshot.id, prisma)).map((face) => face.name);

      assert.deepEqual(await findExactFaceMatches("Lighning Bolt", snapshot.id, prisma), []);
      assert.deepEqual(await names("Lighning Bolt"), ["Lightning Bolt"]);
      assert.deepEqual(await names("grizly bears"), ["Grizzly Bears"]);
      assert.deepEqual(await names("Jace"), ["Jace Beleren"]);
      assert.deepEqual((await names("Bolt")).sort(), ["Guiding Bolt", "Lightning Bolt"]);
      assert.deepEqual(await names("xq"), []);
      assert.deepEqual(await names("Completely unrelated words"), []);
      // Long or many-word input is not a card name and gets no approximate pass.
      assert.deepEqual(await names("the bolt of the bears and the jace of the bolt"), []);
      assert.deepEqual(await names(`Lightning Bolt ${"x".repeat(60)}`), []);

      // Lookups say whether a match is exact, so clients never auto-select a guess.
      const exact = await lookupCardsByName("lightning bolt", prisma, snapshot.id);
      assert.deepEqual(
        exact.cards.map((card) => [card.name, card.matchKind]),
        [["Lightning Bolt", "exact"]],
      );
      const guessed = await lookupCardsByName("Lighning Bolt", prisma, snapshot.id);
      assert.deepEqual(
        guessed.cards.map((card) => [card.name, card.matchKind]),
        [["Lightning Bolt", "approximate"]],
      );
    } finally {
      await prisma.dataSnapshot.deleteMany({ where: { id: snapshot.id } });
    }
  });
});
