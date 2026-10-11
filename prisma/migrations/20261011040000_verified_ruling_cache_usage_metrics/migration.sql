ALTER TABLE "AiUsageReservation"
ADD COLUMN "inputTokens" INTEGER,
ADD COLUMN "outputTokens" INTEGER;

CREATE TABLE "VerifiedRulingCache" (
    "key" CHAR(64) NOT NULL,
    "snapshotId" UUID NOT NULL,
    "answer" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "VerifiedRulingCache_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "VerifiedRulingCache_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "DataSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "VerifiedRulingCache_snapshotId_expiresAt_idx" ON "VerifiedRulingCache"("snapshotId", "expiresAt");
CREATE INDEX "VerifiedRulingCache_expiresAt_idx" ON "VerifiedRulingCache"("expiresAt");
