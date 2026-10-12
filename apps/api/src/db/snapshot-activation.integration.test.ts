import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import {
  CardFaceRole,
  CitationKind,
  PrismaClient,
  RulingOutcome,
  SnapshotStatus,
  SourceKind,
} from "@prisma/client";
import { describe, it } from "node:test";
import { PrismaOracleSnapshotWriter } from "../cards/oracle-import.js";
import { PrismaRulesSnapshotWriter } from "../rules/import.js";
import {
  assembleConfirmedEvidence,
  assembleEvidence,
  InvalidConfirmedCardsError,
} from "../search/retrieval.js";
import { getSourceStatus } from "../sources/status.js";
import { ORACLE_METADATA_URL, refreshAllSources } from "../sources/refresh.js";
import type { OracleBulkMetadata } from "../cards/source.js";

const enabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === "true";

void describe("snapshot activation integration", { skip: !enabled }, () => {
  void it("keeps the last good snapshot active on failure and retains old citations on refresh", async () => {
    const prisma = new PrismaClient();
    const testSnapshots: string[] = [];
    const testRefreshRunIds = [randomUUID(), randomUUID(), randomUUID()] as const;
    let questionId: string | undefined;
    const originallyActive = await prisma.dataSnapshot.findMany({
      where: { status: SnapshotStatus.ACTIVE },
      select: { id: true },
    });
    const now = new Date("2026-10-10T00:00:00.000Z");
    const checksum = (digit: string): string => digit.repeat(64);

    try {
      await prisma.dataSnapshot.updateMany({
        where: { status: SnapshotStatus.ACTIVE },
        data: { status: SnapshotStatus.RETIRED },
      });
      const rulesWriter = new PrismaRulesSnapshotWriter(prisma);
      const baseline = await rulesWriter.activateRulesSnapshot({
        version: `d04-baseline-${randomUUID()}`,
        sourceUrl: "https://example.invalid/rules",
        sourcePublishedAt: now,
        checksumSha256: checksum("1"),
        importedAt: now,
        rules: fixtureRules(),
      });
      testSnapshots.push(baseline.id);

      const cardsWriter = new PrismaOracleSnapshotWriter(prisma);
      const oracle = await cardsWriter.activateOracleSnapshot({
        version: `d04-oracle-${randomUUID()}`,
        sourceVersion: "2026-10-10T00:00:00.000Z",
        sourceUrl: "https://example.invalid/oracle.jsonl.gz",
        sourcePublishedAt: now,
        checksumSha256: checksum("2"),
        importerRevision: 1,
        importedAt: now,
        minimumCardCount: 1,
        cards: oneCard(),
      });
      testSnapshots.push(oracle.id);

      const originalRule = await prisma.rule.findFirstOrThrow({ where: { snapshotId: oracle.id } });
      const originalFace = await prisma.cardFace.findFirstOrThrow({
        where: { card: { snapshotId: oracle.id } },
      });
      const rulesSource = await prisma.sourceSnapshot.findFirstOrThrow({
        where: { snapshotId: oracle.id, kind: SourceKind.COMPREHENSIVE_RULES },
      });
      const cardsSource = await prisma.sourceSnapshot.findFirstOrThrow({
        where: { snapshotId: oracle.id, kind: SourceKind.ORACLE_CARDS },
      });
      const question = await prisma.question.create({ data: { text: "D04 snapshot test" } });
      questionId = question.id;
      const ruling = await prisma.ruling.create({ data: { questionId: question.id } });
      const rulingVersion = await prisma.rulingVersion.create({
        data: {
          rulingId: ruling.id,
          snapshotId: oracle.id,
          version: 1,
          outcome: RulingOutcome.RESOLVED,
          summary: "The fixture is resolved.",
          reasoningSteps: [],
        },
      });
      const citations = await prisma.rulingCitation.createMany({
        data: [
          {
            rulingVersionId: rulingVersion.id,
            kind: CitationKind.RULE,
            ruleId: originalRule.id,
            label: originalRule.number,
            excerpt: originalRule.text,
            sourceUrl: "https://example.invalid/rules",
            sourceSnapshotId: rulesSource.id,
          },
          {
            rulingVersionId: rulingVersion.id,
            kind: CitationKind.CARD,
            cardFaceId: originalFace.id,
            label: originalFace.name,
            excerpt: originalFace.oracleText,
            sourceUrl: "https://example.invalid/oracle",
            sourceSnapshotId: cardsSource.id,
          },
        ],
      });
      assert.equal(citations.count, 2);

      await assert.rejects(
        cardsWriter.activateOracleSnapshot({
          version: `d04-failing-${randomUUID()}`,
          sourceVersion: "2026-10-11T00:00:00.000Z",
          sourceUrl: "https://example.invalid/oracle.jsonl.gz",
          sourcePublishedAt: now,
          checksumSha256: checksum("3"),
          importerRevision: 1,
          importedAt: now,
          minimumCardCount: 2,
          cards: oneCard(),
        }),
        /only 1 cards/,
      );
      assert.equal(
        (await prisma.dataSnapshot.findFirstOrThrow({ where: { status: SnapshotStatus.ACTIVE } }))
          .id,
        oracle.id,
      );

      const reprocessed = await cardsWriter.activateOracleSnapshot({
        version: `d04-oracle-v2-${randomUUID()}`,
        sourceVersion: "2026-10-10T00:00:00.000Z",
        sourceUrl: "https://example.invalid/oracle.jsonl.gz",
        sourcePublishedAt: now,
        checksumSha256: checksum("2"),
        importerRevision: 2,
        importedAt: now,
        minimumCardCount: 1,
        cards: oneCard(),
      });
      testSnapshots.push(reprocessed.id);
      assert.notEqual(
        reprocessed.id,
        oracle.id,
        "a new normalizer revision reprocesses unchanged source data",
      );
      assert.equal(
        (await prisma.dataSnapshot.findFirstOrThrow({ where: { status: SnapshotStatus.ACTIVE } }))
          .id,
        reprocessed.id,
      );

      const refreshed = await rulesWriter.activateRulesSnapshot({
        version: `d04-rules-${randomUUID()}`,
        sourceUrl: "https://example.invalid/rules",
        sourcePublishedAt: now,
        checksumSha256: checksum("4"),
        importedAt: now,
        rules: fixtureRules(true, true),
      });
      testSnapshots.push(refreshed.id);
      const unchangedOracle = await cardsWriter.activateOracleSnapshot({
        version: `d04-oracle-v2-retry-${randomUUID()}`,
        sourceVersion: "2026-10-10T00:00:00.000Z",
        sourceUrl: "https://example.invalid/oracle.jsonl.gz",
        sourcePublishedAt: now,
        checksumSha256: checksum("2"),
        importerRevision: 2,
        importedAt: now,
        minimumCardCount: 1,
        cards: oneCard(),
      });
      testSnapshots.push(unchangedOracle.id);
      assert.equal(
        unchangedOracle.id,
        refreshed.id,
        "unchanged Oracle data remains a no-op after rules refresh",
      );
      assert.equal(
        await prisma.card.count({ where: { snapshotId: refreshed.id } }),
        1,
        "rules refresh preserves the active card corpus",
      );
      assert.equal(
        await prisma.cardFace.count({ where: { card: { snapshotId: refreshed.id } } }),
        1,
        "rules refresh preserves card faces",
      );
      assert.ok(
        await prisma.sourceSnapshot.findFirst({
          where: { snapshotId: refreshed.id, kind: SourceKind.ORACLE_CARDS },
        }),
      );
      const packet = await assembleEvidence(
        { question: "How is damage assigned in order?", cardNames: ["D04 Fixture Card"] },
        prisma,
      );
      assert.equal(packet.snapshot.id, refreshed.id);
      assert.equal(packet.cards[0]?.matchedFace.name, "D04 Fixture Card");
      assert.ok(
        packet.rules.some((rule) => rule.number === "100.1" && rule.includedBecause === "MATCH"),
      );
      assert.ok(
        packet.rules.some(
          (rule) => rule.number === "200.1" && rule.includedBecause === "REFERENCE",
        ),
      );
      assert.ok(
        packet.rules.some((rule) => rule.number === "100" && rule.includedBecause === "PARENT"),
      );
      // A real question uses words no single rule contains; any shared term should still match.
      const conversational = await assembleEvidence(
        {
          question:
            "My opponent blocked my attacker with two creatures. How does my creature split its damage between them?",
          cardNames: [],
        },
        prisma,
      );
      assert.ok(
        conversational.rules.some(
          (rule) => rule.number === "100.1" && rule.includedBecause === "MATCH",
        ),
      );
      const activeCard = await prisma.card.findFirstOrThrow({
        where: { snapshotId: refreshed.id },
        select: { oracleId: true },
      });
      const confirmedPacket = await assembleConfirmedEvidence(
        {
          question: "How is damage assigned in order?",
          gameState: { events: ["The card attacked."], searchTerms: ["damage order"] },
          confirmedCards: [{ oracleId: activeCard.oracleId, faceIndex: 0, quantity: 3 }],
        },
        prisma,
      );
      assert.equal(confirmedPacket.snapshot.id, refreshed.id);
      assert.ok(confirmedPacket.sources.some(({ id }) => id));
      assert.equal(confirmedPacket.cards.length, 1);
      assert.equal(confirmedPacket.cards[0]?.oracleId, activeCard.oracleId);
      assert.equal(confirmedPacket.cards[0]?.selectedFaceIndex, 0);
      assert.equal(confirmedPacket.cards[0]?.quantity, 3);
      assert.equal(
        confirmedPacket.cards[0]?.matchedFace.oracleText,
        "This card is a test fixture.",
      );
      await assert.rejects(
        assembleConfirmedEvidence(
          {
            question: "Fixture question",
            confirmedCards: [{ oracleId: "not-in-active-snapshot", faceIndex: 0, quantity: 1 }],
          },
          prisma,
        ),
        InvalidConfirmedCardsError,
      );
      const overloadedPacket = await assembleEvidence(
        { question: "damage assigned", cardNames: [] },
        prisma,
      );
      assert.equal(overloadedPacket.truncated, true, "omitted matching rules are reported");
      const referenceOverflowPacket = await assembleEvidence(
        { question: "400", cardNames: [] },
        prisma,
      );
      assert.equal(referenceOverflowPacket.truncated, true, "excess references are reported");
      const expansionOverflowPacket = await assembleEvidence(
        { question: "500 501", cardNames: [] },
        prisma,
      );
      assert.equal(expansionOverflowPacket.truncated, true, "unexpanded evidence is reported");
      assert.ok(await prisma.rule.findUnique({ where: { id: originalRule.id } }));
      assert.ok(await prisma.cardFace.findUnique({ where: { id: originalFace.id } }));
      assert.equal(
        await prisma.rulingCitation.count({ where: { rulingVersionId: rulingVersion.id } }),
        2,
      );
      assert.equal(
        (await prisma.rulingVersion.findUniqueOrThrow({ where: { id: rulingVersion.id } }))
          .snapshotId,
        oracle.id,
      );

      let downloadedOracleFiles = 0;
      const metadata: OracleBulkMetadata = {
        updatedAt: new Date("2026-10-12T00:00:00.000Z"),
        sourceUrl: ORACLE_METADATA_URL,
        downloadUrl: "https://data.scryfall.io/oracle-cards.jsonl.gz",
        declaredSize: null,
      };
      const rulingsMetadata: OracleBulkMetadata = {
        updatedAt: new Date("2026-10-12T00:00:00.000Z"),
        sourceUrl: "https://api.scryfall.com/bulk-data/rulings",
        downloadUrl: "https://data.scryfall.io/rulings.jsonl.gz",
        declaredSize: null,
      };
      const fixtureOracleId = `d06-card-${randomUUID()}`;
      const rulingsFileContents = gzipSync(
        [
          {
            source: "wotc",
            oracle_id: fixtureOracleId,
            published_at: "2026-10-01",
            comment: "An official ruling.",
          },
          {
            source: "scryfall",
            oracle_id: fixtureOracleId,
            published_at: "2026-10-01",
            comment: "A Scryfall note.",
          },
        ]
          .map((ruling) => JSON.stringify(ruling))
          .join("\n"),
      );
      const oracleFileContents = gzipSync(
        `${JSON.stringify({
          oracle_id: fixtureOracleId,
          name: "D06 Refresh Fixture",
          layout: "normal",
          type_line: "Creature",
          oracle_text: "This is a source refresh fixture.",
        })}\n`,
      );
      const refreshDependencies = {
        fetchRulesDocument: () =>
          Promise.resolve({
            sourceUrl: "https://media.wizards.com/test-rules.txt",
            text: refreshRulesDocument(),
          }),
        fetchOracleMetadata: () => Promise.resolve(metadata),
        fetchRulingsMetadata: () => Promise.resolve(rulingsMetadata),
        downloadOracleBulk: async (sourceMetadata: OracleBulkMetadata) => {
          downloadedOracleFiles += 1;
          const contents =
            sourceMetadata === rulingsMetadata ? rulingsFileContents : oracleFileContents;
          const directory = await mkdtemp(join(tmpdir(), "d06-oracle-fixture-"));
          const filePath = join(directory, "bulk.jsonl.gz");
          await writeFile(filePath, contents);
          return {
            metadata: sourceMetadata,
            filePath,
            checksumSha256: createHash("sha256").update(contents).digest("hex"),
            byteLength: contents.byteLength,
          };
        },
        removeDownloadedOracleBulk: async (download: { filePath: string }) => {
          await rm(dirname(download.filePath), { recursive: true, force: true });
        },
        minimumRuleCount: 10,
        minimumOracleCardCount: 1,
        minimumRulingCount: 1,
      };
      const firstRefresh = await refreshAllSources(
        prisma,
        refreshDependencies,
        testRefreshRunIds[0],
      );
      assert.deepEqual(
        firstRefresh.map(({ status }) => status),
        ["IMPORTED", "IMPORTED"],
      );
      const refreshedSnapshot = await prisma.dataSnapshot.findFirstOrThrow({
        where: { status: SnapshotStatus.ACTIVE },
        include: { sources: true },
      });
      assert.ok(refreshedSnapshot.sources.some(({ kind }) => kind === "OFFICIAL_RULINGS"));
      assert.deepEqual(
        (
          await prisma.cardRuling.findMany({
            where: { card: { snapshotId: refreshedSnapshot.id } },
            select: { text: true },
          })
        ).map(({ text }) => text),
        ["An official ruling."],
        "only Wizards rulings are imported",
      );
      const refreshSnapshots = await prisma.dataSnapshot.findMany({
        where: {
          version: {
            in: firstRefresh.flatMap(({ snapshotVersion }) =>
              snapshotVersion ? [snapshotVersion] : [],
            ),
          },
        },
        select: { id: true },
      });
      testSnapshots.push(...refreshSnapshots.map(({ id }) => id));
      const secondRefresh = await refreshAllSources(
        prisma,
        refreshDependencies,
        testRefreshRunIds[1],
      );
      assert.deepEqual(
        secondRefresh.map(({ status }) => status),
        ["UNCHANGED", "UNCHANGED"],
      );
      assert.equal(
        downloadedOracleFiles,
        2,
        "unchanged Scryfall metadata skips the bulk downloads",
      );
      const failedRefresh = await refreshAllSources(
        prisma,
        {
          ...refreshDependencies,
          fetchRulesDocument: () => Promise.reject(new Error("synthetic source outage")),
        },
        testRefreshRunIds[2],
      );
      assert.equal(failedRefresh[0]?.status, "FAILED");
      const sourceStatus = await getSourceStatus(prisma);
      assert.equal(sourceStatus.activeSnapshot?.id, refreshedSnapshot.id);
      assert.equal(
        sourceStatus.sources.find(({ kind }) => kind === "COMPREHENSIVE_RULES")?.stale,
        true,
        "a failed refresh raises the stale-source signal",
      );
    } finally {
      try {
        if (questionId) await prisma.question.deleteMany({ where: { id: questionId } });
        await prisma.sourceRefreshLog.deleteMany({
          where: { runId: { in: [...testRefreshRunIds] } },
        });
        await prisma.rulingCitation.deleteMany({
          where: { rulingVersion: { snapshotId: { in: testSnapshots } } },
        });
        await prisma.rulingVersion.deleteMany({ where: { snapshotId: { in: testSnapshots } } });
        await prisma.dataSnapshot.deleteMany({ where: { id: { in: testSnapshots } } });
      } finally {
        try {
          await prisma.dataSnapshot.updateMany({
            where: { id: { in: originallyActive.map(({ id }) => id) } },
            data: { status: SnapshotStatus.ACTIVE },
          });
        } finally {
          await prisma.$disconnect();
        }
      }
    }
  });
});

function fixtureRules(refreshed = false, overloadSearch = false) {
  const rules: Array<{
    number: string;
    text: string;
    sortOrder: number;
    parentNumber: string | null;
    references: string[];
  }> = [
    { number: "100", text: "General rules.", sortOrder: 0, parentNumber: null, references: [] },
    {
      number: "100.1",
      text: refreshed
        ? "Damage is assigned in order after refresh."
        : "Damage is assigned in order.",
      sortOrder: 1,
      parentNumber: "100",
      references: ["200.1"],
    },
    { number: "200", text: "Combat rules.", sortOrder: 2, parentNumber: null, references: [] },
    {
      number: "200.1",
      text: "An attacking creature is an attacker.",
      sortOrder: 3,
      parentNumber: "200",
      references: [],
    },
  ];
  if (overloadSearch) {
    rules.push({
      number: "300",
      text: "Additional damage rules.",
      sortOrder: 4,
      parentNumber: null,
      references: [],
    });
    for (let index = 1; index <= 9; index += 1) {
      rules.push({
        number: `300.${index}`,
        text: `Damage is assigned under additional rule ${index}.`,
        sortOrder: 4 + index,
        parentNumber: "300",
        references: [],
      });
    }
    rules.push({
      number: "400",
      text: "A rule with many references.",
      sortOrder: 14,
      parentNumber: null,
      references: Array.from({ length: 13 }, (_, index) => `${401 + index}`),
    });
    for (let number = 401; number <= 413; number += 1) {
      rules.push({
        number: `${number}`,
        text: `Reference target ${number}.`,
        sortOrder: 14 + number - 400,
        parentNumber: null,
        references: [],
      });
    }
    for (const [root, firstTarget] of [
      [500, 510],
      [501, 530],
    ] as const) {
      rules.push({
        number: `${root}`,
        text: `A rule with expansion targets ${root}.`,
        sortOrder: 30 + root - 500,
        parentNumber: null,
        references: Array.from({ length: 12 }, (_, index) => `${firstTarget + index}`),
      });
      for (let index = 0; index < 12; index += 1) {
        const number = firstTarget + index;
        rules.push({
          number: `${number}`,
          text: `Expansion target ${number}.`,
          sortOrder: 32 + number - 510,
          parentNumber: null,
          references: [],
        });
      }
    }
  }
  return rules;
}

function refreshRulesDocument(): string {
  return [
    "Magic: The Gathering Comprehensive Rules",
    "These rules are effective as of October 10, 2026.",
    "Contents",
    "Credits",
    "1. Game Concepts",
    ...[100, 200, 300, 400, 500, 600, 700, 800, 900].flatMap((section) => [
      `${section}. Section`,
      `${section}.1. D06 synthetic refresh rule ${section}.`,
    ]),
    "Glossary",
    "Synthetic glossary entry.",
  ].join("\n");
}

function oneCard() {
  return Readable.from([
    {
      oracleId: `d04-card-${randomUUID()}`,
      name: "D04 Fixture Card",
      layout: "normal",
      typeLine: "Creature",
      oracleText: "This card is a test fixture.",
      faces: [
        {
          faceIndex: 0,
          role: CardFaceRole.OTHER,
          name: "D04 Fixture Card",
          manaCost: "",
          typeLine: "Creature",
          oracleText: "This card is a test fixture.",
          power: null,
          toughness: null,
          imageUri: null,
        },
      ],
    },
  ]);
}
