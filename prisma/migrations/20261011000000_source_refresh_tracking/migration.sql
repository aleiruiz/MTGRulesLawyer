CREATE TYPE "SourceRefreshStatus" AS ENUM ('RUNNING', 'UNCHANGED', 'IMPORTED', 'FAILED');

CREATE TABLE "SourceRefreshLog" (
    "id" UUID NOT NULL,
    "kind" "SourceKind" NOT NULL,
    "status" "SourceRefreshStatus" NOT NULL DEFAULT 'RUNNING',
    "sourceUrl" TEXT NOT NULL,
    "sourceVersion" TEXT,
    "checksumSha256" CHAR(64),
    "snapshotVersion" TEXT,
    "checkedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(6),
    "errorMessage" TEXT,

    CONSTRAINT "SourceRefreshLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SourceRefreshLog_kind_checkedAt_idx"
ON "SourceRefreshLog"("kind", "checkedAt" DESC);
