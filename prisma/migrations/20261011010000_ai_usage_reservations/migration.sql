CREATE TYPE "AiReservationStatus" AS ENUM ('RESERVED', 'IN_PROGRESS', 'COMPLETED', 'RELEASED');

CREATE TABLE "AiUsageReservation" (
    "id" UUID NOT NULL,
    "accountHash" TEXT,
    "ipHash" TEXT NOT NULL,
    "kind" "UsageKind" NOT NULL,
    "status" "AiReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "reservedCostMicros" BIGINT NOT NULL,
    "actualCostMicros" BIGINT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "completedAt" TIMESTAMPTZ(6),

    CONSTRAINT "AiUsageReservation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiUsageReservation_accountHash_kind_createdAt_idx"
    ON "AiUsageReservation"("accountHash", "kind", "createdAt");
CREATE INDEX "AiUsageReservation_ipHash_kind_createdAt_idx"
    ON "AiUsageReservation"("ipHash", "kind", "createdAt");
CREATE INDEX "AiUsageReservation_status_expiresAt_idx"
    ON "AiUsageReservation"("status", "expiresAt");
CREATE INDEX "AiUsageReservation_createdAt_idx" ON "AiUsageReservation"("createdAt");
