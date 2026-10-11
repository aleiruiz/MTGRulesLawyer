import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, it } from "node:test";
import { normalizeOracleCard, readOracleCards } from "./oracle-import.js";

const doubleFacedCard = {
  oracle_id: "oracle-double-faced",
  name: "Front Face // Back Face",
  layout: "transform",
  type_line: "Creature // Land",
  oracle_text: "An effect with {symbols} and } braces.",
  card_faces: [
    {
      name: "Front Face",
      mana_cost: "{2}{G}",
      type_line: "Creature — Elf",
      oracle_text: 'Front text with a "quoted phrase".',
      power: "2",
      toughness: "2",
      image_uris: { normal: "https://cards.scryfall.io/normal/front.jpg" },
    },
    {
      name: "Back Face",
      mana_cost: "",
      type_line: "Land",
      oracle_text: "Back text.",
      image_uris: { normal: "https://cards.scryfall.io/normal/back.jpg" },
    },
  ],
};

async function withBulkFile<T>(content: string, run: (path: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "mtg-oracle-test-"));
  const filePath = join(directory, "bulk.json");
  try {
    await writeFile(filePath, content, "utf8");
    return await run(filePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

void describe("Oracle Cards bulk parser", () => {
  void it("normalizes single-face and alternate-face records", async () => {
    const singleFace = {
      oracle_id: "oracle-single",
      name: "Single Card",
      layout: "normal",
      type_line: "Instant",
      oracle_text: "Draw a card.",
      mana_cost: "{U}",
      image_uris: { normal: "https://cards.scryfall.io/normal/single.jpg" },
    };
    const records = await withBulkFile(
      JSON.stringify([doubleFacedCard, singleFace]),
      async (path) => {
        const cards = [];
        for await (const card of readOracleCards(path)) cards.push(card);
        return cards;
      },
    );

    assert.equal(records.length, 2);
    assert.equal(records[0]?.faces[1]?.name, "Back Face");
    assert.equal(records[0]?.faces[1]?.role, "BACK");
    assert.equal(records[0]?.oracleText, "An effect with {symbols} and } braces.");
    assert.equal(records[1]?.faces[0]?.name, "Single Card");
    assert.equal(records[1]?.faces[0]?.imageUri, "https://cards.scryfall.io/normal/single.jpg");
  });

  void it("does not label split card parts as physical front and back faces", () => {
    const card = normalizeOracleCard({
      oracle_id: "oracle-split",
      name: "Fire // Ice",
      layout: "split",
      card_faces: [
        { name: "Fire", mana_cost: "{1}{R}", oracle_text: "Deal 2 damage." },
        { name: "Ice", mana_cost: "{1}{U}", oracle_text: "Tap target permanent." },
      ],
    });

    assert.deepEqual(
      card.faces.map((face) => face.role),
      ["OTHER", "OTHER"],
    );
  });

  void it("rejects malformed or truncated bulk arrays", async () => {
    const validCard = '{"oracle_id":"broken","name":"Broken","layout":"normal"}';
    await withBulkFile(`[${validCard},]`, async (path) => {
      await assert.rejects(async () => {
        for await (const card of readOracleCards(path)) {
          assert.equal(card.name, "Broken");
        }
      }, /trailing array comma/);
    });
    await withBulkFile(`[${validCard}`, async (path) => {
      await assert.rejects(async () => {
        for await (const card of readOracleCards(path)) {
          assert.equal(card.name, "Broken");
        }
      }, /array was complete/);
    });
  });

  void it("reads the current compressed JSONL bulk format", async () => {
    const compressed = gzipSync(Buffer.from(`${JSON.stringify(doubleFacedCard)}\n`, "utf8"));
    const directory = await mkdtemp(join(tmpdir(), "mtg-oracle-jsonl-test-"));
    const filePath = join(directory, "bulk.jsonl.gz");
    try {
      await writeFile(filePath, compressed);
      const cards = [];
      for await (const card of readOracleCards(filePath)) cards.push(card);
      assert.equal(cards.length, 1);
      assert.equal(cards[0]?.faces[1]?.name, "Back Face");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
