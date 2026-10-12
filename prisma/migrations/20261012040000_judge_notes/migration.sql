-- CreateTable
CREATE TABLE "JudgeNote" (
    "id" UUID NOT NULL,
    "snapshotId" UUID NOT NULL,
    "oracleIds" TEXT[],
    "outcome" "RulingOutcome" NOT NULL,
    "summary" TEXT NOT NULL,
    "reasoning" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ruleNumbers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JudgeNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JudgeNote_snapshotId_createdAt_idx" ON "JudgeNote"("snapshotId", "createdAt" DESC);

-- Notes are found by overlapping Oracle IDs.
CREATE INDEX "JudgeNote_oracleIds_idx" ON "JudgeNote" USING GIN ("oracleIds");

-- AddForeignKey
ALTER TABLE "JudgeNote" ADD CONSTRAINT "JudgeNote_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "DataSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
