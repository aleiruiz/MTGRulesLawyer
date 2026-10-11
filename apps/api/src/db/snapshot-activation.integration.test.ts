import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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

const enabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === "true";

void describe("snapshot activation integration", { skip: !enabled }, () => {
  void it("keeps the last good snapshot active on failure and retains old citations on refresh", async () => {
    const prisma = new PrismaClient();
    const testSnapshots: string[] = [];
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
        rules: [
          {
            number: "100",
            text: "General rules.",
            sortOrder: 0,
            parentNumber: null,
            references: [],
          },
        ],
      });
      testSnapshots.push(baseline.id);

      const cardsWriter = new PrismaOracleSnapshotWriter(prisma);
      const oracle = await cardsWriter.activateOracleSnapshot({
        version: `d04-oracle-${randomUUID()}`,
        sourceVersion: "2026-10-10T00:00:00.000Z",
        sourceUrl: "https://example.invalid/oracle.jsonl.gz",
        sourcePublishedAt: now,
        checksumSha256: checksum("2"),
        importedAt: now,
        minimumCardCount: 1,
        cards: oneCard(),
      });
      testSnapshots.push(oracle.id);

      const originalRule = await prisma.rule.findFirstOrThrow({ where: { snapshotId: oracle.id } });
      const originalFace = await prisma.cardFace.findFirstOrThrow({
        where: { card: { snapshotId: oracle.id } },
      });
      const question = await prisma.question.create({ data: { text: "D04 snapshot test" } });
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
          },
          {
            rulingVersionId: rulingVersion.id,
            kind: CitationKind.CARD,
            cardFaceId: originalFace.id,
            label: originalFace.name,
            excerpt: originalFace.oracleText,
            sourceUrl: "https://example.invalid/oracle",
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

      const refreshed = await rulesWriter.activateRulesSnapshot({
        version: `d04-rules-${randomUUID()}`,
        sourceUrl: "https://example.invalid/rules",
        sourcePublishedAt: now,
        checksumSha256: checksum("4"),
        importedAt: now,
        rules: [
          {
            number: "100",
            text: "General rules, refreshed.",
            sortOrder: 0,
            parentNumber: null,
            references: [],
          },
        ],
      });
      testSnapshots.push(refreshed.id);
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

      await prisma.question.delete({ where: { id: question.id } });
    } finally {
      await prisma.rulingCitation.deleteMany({
        where: { rulingVersion: { snapshotId: { in: testSnapshots } } },
      });
      await prisma.rulingVersion.deleteMany({ where: { snapshotId: { in: testSnapshots } } });
      await prisma.dataSnapshot.deleteMany({ where: { id: { in: testSnapshots } } });
      await prisma.dataSnapshot.updateMany({
        where: { id: { in: originallyActive.map(({ id }) => id) } },
        data: { status: SnapshotStatus.ACTIVE },
      });
      await prisma.$disconnect();
    }
  });
});

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
