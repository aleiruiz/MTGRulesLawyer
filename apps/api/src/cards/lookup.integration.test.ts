import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient, SnapshotStatus } from "@prisma/client";
import { after, describe, it } from "node:test";
import { findApproximateFaceMatches, findExactFaceMatches, lookupCardsByName } from "./lookup.js";
import { refreshLocalizedCardNames } from "./localized-names.js";

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
      for (const name of [
        "Lightning Bolt",
        "Guiding Bolt",
        "Grizzly Bears",
        "Jace Beleren",
        "Tarmogoyf",
      ]) {
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
      // A swapped vowel shares too few trigrams; edit distance still finds the card.
      assert.deepEqual(await names("tormagoyf"), ["Tarmogoyf"]);
      assert.deepEqual(await names("tarmogoff"), ["Tarmogoyf"]);
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

      // The card named exactly this comes first, then cards that only have a face of that
      // name, and tokens after real cards.
      await prisma.card.create({
        data: {
          snapshotId: snapshot.id,
          oracleId: `emeritus-${randomUUID()}`,
          name: "Emeritus of Conflict // Lightning Bolt",
          layout: "prepare",
          faces: {
            create: [
              { faceIndex: 0, name: "Emeritus of Conflict" },
              { faceIndex: 1, name: "Lightning Bolt" },
            ],
          },
        },
      });
      await prisma.card.create({
        data: {
          snapshotId: snapshot.id,
          oracleId: `goyf-token-${randomUUID()}`,
          name: "Tarmogoyf",
          layout: "token",
          faces: { create: { faceIndex: 0, name: "Tarmogoyf" } },
        },
      });
      const bolts = await lookupCardsByName("Lightning Bolt", prisma, snapshot.id);
      assert.deepEqual(
        bolts.cards.map((card) => card.name),
        ["Lightning Bolt", "Emeritus of Conflict // Lightning Bolt"],
      );
      const goyfs = await lookupCardsByName("Tarmogoyf", prisma, snapshot.id);
      assert.deepEqual(
        goyfs.cards.map((card) => card.layout),
        ["normal", "token"],
      );
    } finally {
      await prisma.dataSnapshot.deleteMany({ where: { id: snapshot.id } });
    }
  });

  void it("finds cards by their printed Spanish names, exact or misspelled", async () => {
    const snapshot = await prisma.dataSnapshot.create({
      data: { version: `lookup-es-${randomUUID()}`, status: SnapshotStatus.CANDIDATE },
    });
    const oracleId = `elves-${randomUUID()}`;
    const language = `t${randomUUID().slice(0, 6)}`;
    try {
      await prisma.card.create({
        data: {
          snapshotId: snapshot.id,
          oracleId,
          name: "Llanowar Elves",
          layout: "normal",
          faces: { create: { faceIndex: 0, name: "Llanowar Elves" } },
        },
      });
      await prisma.cardLocalizedName.create({
        data: { oracleId, faceIndex: 0, language, name: "Elfos de Llanowar" },
      });

      const exact = await lookupCardsByName("elfos de llanowar", prisma, snapshot.id);
      assert.deepEqual(
        exact.cards.map((card) => [card.name, card.matchKind]),
        [["Llanowar Elves", "exact"]],
      );
      const guessed = await lookupCardsByName("Elfos de Llanowr", prisma, snapshot.id);
      assert.deepEqual(
        guessed.cards.map((card) => [card.name, card.matchKind]),
        [["Llanowar Elves", "approximate"]],
      );
    } finally {
      await prisma.cardLocalizedName.deleteMany({ where: { language } });
      await prisma.dataSnapshot.deleteMany({ where: { id: snapshot.id } });
    }
  });
});

void describe("Localized card name refresh integration", { skip: !enabled }, () => {
  void it("imports names, keeps them when the file looks truncated, and runs weekly", async () => {
    const metadata = {
      updatedAt: new Date("2026-10-01T00:00:00Z"),
      sourceUrl: "https://api.scryfall.com/bulk-data/all-cards",
      downloadUrl: "https://data.scryfall.io/all-cards/all-cards.json",
      declaredSize: null,
    };
    const oracleId = `refresh-${randomUUID()}`;
    // A made-up language keeps the real Spanish names untouched.
    const language = `t${randomUUID().slice(0, 6)}`;
    const names = [{ oracleId, faceIndex: 0, language, name: "Nombre de prueba" }];
    const startedAt = new Date();
    try {
      // Too few names: the refresh fails and nothing is replaced.
      const truncated = await refreshLocalizedCardNames(
        prisma,
        { force: true },
        {
          fetchMetadata: () => Promise.resolve(metadata),
          readNames: () =>
            Promise.resolve({ names, checksumSha256: "c".repeat(64), byteLength: 1 }),
          minimumNames: 2,
          languages: [language],
        },
      );
      assert.equal(truncated.status, "FAILED");
      assert.equal(await prisma.cardLocalizedName.count({ where: { oracleId } }), 0);

      const imported = await refreshLocalizedCardNames(
        prisma,
        { force: true },
        {
          fetchMetadata: () => Promise.resolve(metadata),
          readNames: () =>
            Promise.resolve({ names, checksumSha256: "c".repeat(64), byteLength: 1 }),
          minimumNames: 1,
          languages: [language],
        },
      );
      assert.deepEqual(imported, { status: "IMPORTED", counts: { [language]: 1 } });
      assert.equal(await prisma.cardLocalizedName.count({ where: { oracleId } }), 1);

      // Within the week, an unforced run does not download anything.
      const skipped = await refreshLocalizedCardNames(
        prisma,
        {},
        {
          fetchMetadata: () => Promise.reject(new Error("should not be called")),
        },
      );
      assert.equal(skipped.status, "SKIPPED");
    } finally {
      await prisma.cardLocalizedName.deleteMany({ where: { language } });
      await prisma.sourceRefreshLog.deleteMany({
        where: { kind: "LOCALIZED_CARD_NAMES", checkedAt: { gte: startedAt } },
      });
    }
  });
});
