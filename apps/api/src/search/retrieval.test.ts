import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { boundEvidenceForPrompt, MAX_PROMPT_CORE_RULES } from "../rulings/generate.js";
import type { PrismaClient } from "@prisma/client";
import {
  addRequestedRules,
  CORE_RULE_NUMBERS,
  rankRulings,
  rulesForCardKeywords,
  withCoreRules,
  withoutCardNames,
  withSubrulesOfHeadings,
} from "./retrieval.js";

void describe("confirmed-card query text", () => {
  void it("removes multi-word card names and their part before a comma", () => {
    assert.equal(
      withoutCardNames("If I have a sakashima of a thousand faces copying it", [
        "Sakashima of a Thousand Faces",
      ]).trim(),
      "If I have a   copying it",
    );
    assert.equal(
      withoutCardNames("Does Lim-Dûl the Necromancer work?", ["Lim-Dûl the Necromancer"]),
      "Does   work?",
    );
  });

  void it("keeps single-word names, which may be rules words", () => {
    const question = "Can I cast Flash at instant speed with flash?";
    assert.equal(withoutCardNames(question, ["Flash", "Gandalf, Party Guest"]), question);
    assert.equal(withoutCardNames("Is Opt a sorcery?", ["Opt"]), "Is Opt a sorcery?");
  });
});

void describe("core rules", () => {
  void it("covers priority, the stack, turn structure, state-based actions, layers and loops", () => {
    for (const section of [
      "117.",
      "405.",
      "603.3b",
      "608.",
      "500.1",
      "704.",
      "613.1",
      "104.4b",
      "732.",
    ]) {
      assert.ok(
        CORE_RULE_NUMBERS.some((number) => number.startsWith(section)),
        `missing ${section}`,
      );
    }
    assert.equal(new Set(CORE_RULE_NUMBERS).size, CORE_RULE_NUMBERS.length);
    // The prompt keeps at most this many core rules; more would be dropped silently.
    assert.ok(CORE_RULE_NUMBERS.length <= MAX_PROMPT_CORE_RULES);
    for (const number of CORE_RULE_NUMBERS) assert.equal(number, number.toLowerCase());
  });

  void it("keeps a core rule the search also found in the prompt, past the searched cap", () => {
    const rule = (id: string, number: string, includedBecause: "MATCH" | "PARENT" | "CORE") => ({
      id,
      number,
      text: `Rule ${number}.`,
      parentNumber: null,
      includedBecause,
      truncated: false,
    });
    const searched = [
      ...Array.from({ length: 14 }, (_, index) => rule(`s${index}`, `999.${index}`, "MATCH")),
      rule("core-613-7", "613.7", "PARENT"),
    ];
    const merged = withCoreRules(searched, [rule("core-613-7", "613.7", "CORE")]);
    assert.equal(merged.filter((item) => item.id === "core-613-7").length, 1);
    const bounded = boundEvidenceForPrompt({
      snapshot: { id: "snapshot", version: "v1", activatedAt: null },
      sources: [],
      cards: [],
      rules: merged,
      truncated: false,
    });
    assert.ok(bounded.rules.some((item) => item.number === "613.7"));
  });
});

void describe("official ruling ranking", () => {
  void it("puts rulings naming another confirmed card first, then shared question words", () => {
    const rulings = [
      { position: 0, text: "This card's ability is a mana ability." },
      { position: 1, text: "If Blood Moon is on the battlefield, this land is a Mountain." },
      { position: 2, text: "Each land is a Swamp in addition to its other types." },
      { position: 3, text: "It doesn't matter who controls it." },
    ];
    assert.deepEqual(
      rankRulings(rulings, "Are all lands Swamps with these on the battlefield?", [
        "Blood Moon",
      ]).map(({ position }) => position),
      [1, 2, 0, 3],
    );
  });
});

void describe("requested rules", () => {
  const packet = {
    snapshot: { id: "snapshot-id", version: "v", activatedAt: null },
    sources: [],
    cards: [],
    rules: [
      {
        id: "legend",
        number: "704.5j",
        text: "Legend rule.",
        parentNumber: "704.5",
        includedBecause: "MATCH" as const,
        truncated: false,
      },
    ],
    truncated: false,
  };
  const fakeClient = (rows: Array<{ id: string; number: string }>) => {
    const queries: string[][] = [];
    const client = {
      rule: {
        findMany: (args: { where: { number: { in: string[] } } }) => {
          queries.push(args.where.number.in);
          return Promise.resolve(
            rows
              .filter(({ number }) => args.where.number.in.includes(number))
              .map((row) => ({ ...row, text: `Text of ${row.number}.`, parent: null })),
          );
        },
      },
    } as unknown as PrismaClient;
    return { client, queries };
  };

  void it("normalizes numbers, caps them, and adds real rule text as REQUESTED", async () => {
    const { client, queries } = fakeClient([
      { id: "legend", number: "704.5j" },
      { id: "cascade", number: "702.85a" },
    ]);
    const extended = await addRequestedRules(
      packet,
      [
        "Rule 704.5J.",
        "702.85a",
        "not a rule",
        "card1",
        "1.1.1",
        "100.1",
        "100.2",
        "100.3",
        "100.4",
        "100.5",
      ],
      client,
    );
    assert.deepEqual(queries, [["704.5j", "702.85a", "100.1", "100.2", "100.3", "100.4"]]);
    assert.ok(extended);
    // A rule already in the packet moves to REQUESTED instead of appearing twice.
    assert.deepEqual(
      extended.rules.map(({ id, includedBecause }) => [id, includedBecause]),
      [
        ["legend", "REQUESTED"],
        ["cascade", "REQUESTED"],
      ],
    );
    assert.equal(extended.rules[1]?.text, "Text of 702.85a.");
  });

  void it("returns null when nothing requested names a rule", async () => {
    const { client, queries } = fakeClient([]);
    assert.equal(await addRequestedRules(packet, ["card1", "uuid-like"], client), null);
    assert.deepEqual(queries, []);
    assert.equal(await addRequestedRules(packet, ["999.9"], client), null);
  });
});

void describe("heading rules", () => {
  void it("adds the first subrules right after a rule that only introduces them", async () => {
    const rule = (id: string, number: string, text: string) => ({
      id,
      number,
      text,
      parentNumber: null,
      includedBecause: "MATCH" as const,
      truncated: false,
    });
    const children = ["a", "b", "c", "d", "e"].map((letter) => ({
      id: `510.1${letter}`,
      number: `510.1${letter}`,
      text: `Subrule ${letter}.`,
      parentId: "510.1",
    }));
    const client = {
      rule: {
        findMany: (args: { where: { parentId: { in: string[] } } }) =>
          Promise.resolve(
            children.filter(({ parentId }) => args.where.parentId.in.includes(parentId)),
          ),
      },
    } as unknown as PrismaClient;
    const rules = await withSubrulesOfHeadings(
      [
        rule("510.1", "510.1", "A player assigns combat damage according to the following rules:"),
        rule("510.1b", "510.1b", "Already found."),
        rule("702.7b", "702.7b", "First strike creatures deal damage first."),
      ],
      "snapshot-id",
      client,
    );
    assert.deepEqual(
      rules.map(({ number }) => number),
      ["510.1", "510.1a", "510.1c", "510.1d", "510.1e", "510.1b", "702.7b"],
    );
    assert.equal(rules[1]?.includedBecause, "REFERENCE");
  });
});

void describe("card keyword rules", () => {
  void it("brings every subrule of the keywords on the cards' keyword lines", async () => {
    const rows = [
      { id: "ds", number: "702.4", text: "Double Strike", parentId: null },
      { id: "tr", number: "702.19", text: "Trample", parentId: null },
      { id: "wa", number: "702.21", text: "Ward", parentId: null },
      { id: "fl", number: "702.9", text: "Flying", parentId: null },
      { id: "es", number: "702.138", text: "Escape", parentId: null },
      { id: "es-a", number: "702.138a", text: "Escape a.", parentId: "es" },
      { id: "ll", number: "702.15", text: "Lifelink", parentId: null },
      { id: "ll-a", number: "702.15a", text: "Lifelink a.", parentId: "ll" },
      ...["a", "b", "c", "d"].map((letter) => ({
        id: `tr-${letter}`,
        number: `702.19${letter}`,
        text: `Trample ${letter}.`,
        parentId: "tr",
      })),
      { id: "ds-a", number: "702.4a", text: "Double strike a.", parentId: "ds" },
      { id: "wa-a", number: "702.21a", text: "Ward a.", parentId: "wa" },
    ];
    const client = {
      rule: {
        findMany: (args: {
          where: { number?: { startsWith: string }; parentId?: { in: string[] } };
        }) =>
          Promise.resolve(
            args.where.parentId
              ? rows.filter(
                  ({ parentId }) => parentId && args.where.parentId?.in.includes(parentId),
                )
              : rows.filter(({ parentId }) => parentId === null),
          ),
      },
    } as unknown as PrismaClient;
    const rules = await rulesForCardKeywords(
      [
        "Double strike, trample\nWard {2} (Whenever this becomes the target...)",
        "This creature can't block flying creatures.",
        "Escape—{3}{B}{B}, Exile five other cards from your graveyard.",
      ],
      "",
      "snapshot-id",
      client,
    );
    // Flying only appears in a sentence, not a keyword line, so it brings nothing.
    assert.deepEqual(
      rules.map(({ number }) => number),
      ["702.4a", "702.19a", "702.19b", "702.19c", "702.19d", "702.21a"],
    );
    // A keyword the card grants counts too.
    const granted = await rulesForCardKeywords(
      ["Equipped creature gets +1/+1 and has lifelink and trample."],
      "Does it trample over?",
      "snapshot-id",
      client,
    );
    assert.deepEqual(
      granted.map(({ number }) => number),
      ["702.19a", "702.19b", "702.19c", "702.19d", "702.15a"],
    );
  });
});
