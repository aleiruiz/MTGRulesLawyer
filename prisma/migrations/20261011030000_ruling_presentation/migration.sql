ALTER TABLE "Question" ADD COLUMN "gameState" JSONB;
ALTER TABLE "RulingVersion"
  ADD COLUMN "summaryCitationIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "clarificationQuestions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "RulingCitation" ADD COLUMN "sourceSnapshotId" UUID;
UPDATE "RulingCitation" AS citation
SET "sourceSnapshotId" = (
  SELECT source."id"
  FROM "RulingVersion" AS version
  JOIN "SourceSnapshot" AS source
    ON source."snapshotId" = version."snapshotId"
   AND source."kind" = CASE
     WHEN citation."kind" = 'RULE'::"CitationKind" THEN 'COMPREHENSIVE_RULES'::"SourceKind"
     ELSE 'ORACLE_CARDS'::"SourceKind"
   END
  WHERE version."id" = citation."rulingVersionId"
  LIMIT 1
);
ALTER TABLE "RulingCitation" ALTER COLUMN "sourceSnapshotId" SET NOT NULL;
ALTER TABLE "RulingCitation"
  ADD CONSTRAINT "RulingCitation_sourceSnapshotId_fkey"
  FOREIGN KEY ("sourceSnapshotId") REFERENCES "SourceSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "RulingCitation_sourceSnapshotId_idx" ON "RulingCitation"("sourceSnapshotId");
