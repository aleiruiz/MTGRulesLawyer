import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient, SnapshotStatus } from "@prisma/client";
import type { RulingGenerationResponse } from "@mtg-rules/contracts";
import { after, describe, it } from "node:test";
import { cacheVerifiedRuling, getCachedVerifiedRuling } from "./cache.js";

const enabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === "true";
const prisma = new PrismaClient();

void after(async () => prisma.$disconnect());

const answer: RulingGenerationResponse = {
  outcome: "resolved",
  summary: "The supplied rule supports this result.",
  reasoningSteps: [{ text: "The effect resolves.", citationIds: ["rule-id"] }],
  summaryCitationIds: ["rule-id"],
  assumptions: [],
  clarificationQuestions: [],
  citations: [
    {
      id: "rule-id",
      kind: "RULE",
      label: "100.1",
      excerpt: "Test rule text.",
      sourceId: "source-id",
      sourceUrl: "https://magic.wizards.com/en/rules",
    },
  ],
  snapshot: { id: "snapshot-id", version: "test-snapshot", activatedAt: null },
  sources: [
    {
      id: "source-id",
      kind: "COMPREHENSIVE_RULES",
      sourceUrl: "https://magic.wizards.com/en/rules",
      sourceVersion: "test-snapshot",
      sourcePublishedAt: null,
      checksumSha256: "a".repeat(64),
    },
  ],
  modelName: "gpt-6-luna",
  promptVersion: "verified-ruling-v1",
};

void describe("verified ruling cache integration", { skip: !enabled }, () => {
  void it("reuses a persisted verified answer only while its cache entry is fresh", async () => {
    const snapshot = await prisma.dataSnapshot.create({
      data: { version: `r09-cache-${randomUUID()}`, status: SnapshotStatus.CANDIDATE },
    });
    const key = randomUUID().replaceAll("-", "").padEnd(64, "0").slice(0, 64);
    const now = new Date();
    try {
      await cacheVerifiedRuling(
        key,
        snapshot.id,
        { ...answer, snapshot: { ...answer.snapshot, id: snapshot.id } },
        prisma,
        now,
      );
      assert.deepEqual(await getCachedVerifiedRuling(key, prisma, now), {
        ...answer,
        snapshot: { ...answer.snapshot, id: snapshot.id },
      });
      assert.equal(
        await getCachedVerifiedRuling(key, prisma, new Date(now.getTime() + 86_400_000)),
        null,
      );
    } finally {
      await prisma.verifiedRulingCache.deleteMany({ where: { key } });
      await prisma.dataSnapshot.deleteMany({ where: { id: snapshot.id } });
    }
  });
});
