-- CreateEnum
CREATE TYPE "SnapshotStatus" AS ENUM ('CANDIDATE', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "SourceKind" AS ENUM ('COMPREHENSIVE_RULES', 'ORACLE_CARDS', 'OFFICIAL_RULINGS');

-- CreateEnum
CREATE TYPE "QuestionStatus" AS ENUM ('SUBMITTED', 'INTERPRETED', 'ANSWERED', 'NEEDS_INFORMATION');

-- CreateEnum
CREATE TYPE "CardFaceRole" AS ENUM ('FRONT', 'BACK', 'OTHER');

-- CreateEnum
CREATE TYPE "RulingOutcome" AS ENUM ('RESOLVED', 'CONDITIONAL', 'NEEDS_INFORMATION', 'UNCERTAIN');

-- CreateEnum
CREATE TYPE "CitationKind" AS ENUM ('RULE', 'CARD');

-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('GOOGLE', 'APPLE', 'GITHUB');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "ChallengeStatus" AS ENUM ('OPEN', 'NEEDS_INFORMATION', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReviewDecision" AS ENUM ('REQUEST_INFORMATION', 'APPROVE', 'REJECT');

-- CreateEnum
CREATE TYPE "UsageKind" AS ENUM ('INTERPRETATION', 'RULING');

-- CreateTable
CREATE TABLE "DataSnapshot" (
    "id" UUID NOT NULL,
    "version" TEXT NOT NULL,
    "status" "SnapshotStatus" NOT NULL DEFAULT 'CANDIDATE',
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMPTZ(6),

    CONSTRAINT "DataSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceSnapshot" (
    "id" UUID NOT NULL,
    "snapshotId" UUID NOT NULL,
    "kind" "SourceKind" NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "sourceVersion" TEXT,
    "sourcePublishedAt" TIMESTAMPTZ(6),
    "importedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checksumSha256" CHAR(64) NOT NULL,

    CONSTRAINT "SourceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rule" (
    "id" UUID NOT NULL,
    "snapshotId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "parentId" UUID,

    CONSTRAINT "Rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleCrossReference" (
    "id" UUID NOT NULL,
    "fromRuleId" UUID NOT NULL,
    "toRuleId" UUID NOT NULL,

    CONSTRAINT "RuleCrossReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Card" (
    "id" UUID NOT NULL,
    "snapshotId" UUID NOT NULL,
    "oracleId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "layout" TEXT NOT NULL,
    "typeLine" TEXT NOT NULL DEFAULT '',
    "oracleText" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardFace" (
    "id" UUID NOT NULL,
    "cardId" UUID NOT NULL,
    "faceIndex" INTEGER NOT NULL,
    "role" "CardFaceRole" NOT NULL DEFAULT 'OTHER',
    "name" TEXT NOT NULL,
    "manaCost" TEXT NOT NULL DEFAULT '',
    "typeLine" TEXT NOT NULL DEFAULT '',
    "oracleText" TEXT NOT NULL DEFAULT '',
    "power" TEXT,
    "toughness" TEXT,
    "imageUri" TEXT,

    CONSTRAINT "CardFace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "text" TEXT NOT NULL,
    "status" "QuestionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionCard" (
    "id" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "cardId" UUID NOT NULL,
    "faceId" UUID,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "position" INTEGER NOT NULL,
    "confirmedAt" TIMESTAMPTZ(6),

    CONSTRAINT "QuestionCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ruling" (
    "id" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ruling_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RulingVersion" (
    "id" UUID NOT NULL,
    "rulingId" UUID NOT NULL,
    "snapshotId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "outcome" "RulingOutcome" NOT NULL,
    "summary" TEXT NOT NULL,
    "reasoningSteps" JSONB NOT NULL,
    "assumptions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "modelName" TEXT,
    "promptVersion" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RulingVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RulingCitation" (
    "id" UUID NOT NULL,
    "rulingVersionId" UUID NOT NULL,
    "kind" "CitationKind" NOT NULL,
    "ruleId" UUID,
    "cardFaceId" UUID,
    "label" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,

    CONSTRAINT "RulingCitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppUser" (
    "id" UUID NOT NULL,
    "authProvider" "AuthProvider" NOT NULL,
    "providerSubject" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AppUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Challenge" (
    "id" UUID NOT NULL,
    "rulingVersionId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "explanation" TEXT NOT NULL,
    "proposedOutcome" "RulingOutcome",
    "status" "ChallengeStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Challenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewEvent" (
    "id" UUID NOT NULL,
    "challengeId" UUID NOT NULL,
    "reviewerId" UUID NOT NULL,
    "decision" "ReviewDecision" NOT NULL,
    "fromStatus" "ChallengeStatus",
    "toStatus" "ChallengeStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "correctedVersionId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageWindow" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "kind" "UsageKind" NOT NULL,
    "principalHash" TEXT NOT NULL,
    "windowStartedAt" TIMESTAMPTZ(6) NOT NULL,
    "windowEndsAt" TIMESTAMPTZ(6) NOT NULL,
    "unitsReserved" INTEGER NOT NULL DEFAULT 0,
    "unitsConsumed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageWindow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DataSnapshot_version_key" ON "DataSnapshot"("version");

-- CreateIndex
CREATE INDEX "DataSnapshot_status_createdAt_idx" ON "DataSnapshot"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "SourceSnapshot_kind_importedAt_idx" ON "SourceSnapshot"("kind", "importedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "SourceSnapshot_snapshotId_kind_key" ON "SourceSnapshot"("snapshotId", "kind");

-- CreateIndex
CREATE INDEX "Rule_snapshotId_sortOrder_idx" ON "Rule"("snapshotId", "sortOrder");

-- CreateIndex
CREATE INDEX "Rule_parentId_idx" ON "Rule"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Rule_snapshotId_number_key" ON "Rule"("snapshotId", "number");

-- CreateIndex
CREATE INDEX "RuleCrossReference_toRuleId_idx" ON "RuleCrossReference"("toRuleId");

-- CreateIndex
CREATE UNIQUE INDEX "RuleCrossReference_fromRuleId_toRuleId_key" ON "RuleCrossReference"("fromRuleId", "toRuleId");

-- CreateIndex
CREATE INDEX "Card_snapshotId_name_idx" ON "Card"("snapshotId", "name");

-- CreateIndex
CREATE INDEX "Card_name_idx" ON "Card"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Card_snapshotId_oracleId_key" ON "Card"("snapshotId", "oracleId");

-- CreateIndex
CREATE INDEX "CardFace_name_idx" ON "CardFace"("name");

-- CreateIndex
CREATE UNIQUE INDEX "CardFace_cardId_faceIndex_key" ON "CardFace"("cardId", "faceIndex");

-- Required so QuestionCard can enforce that a selected face belongs to its selected card.
CREATE UNIQUE INDEX "CardFace_id_cardId_key" ON "CardFace"("id", "cardId");

-- CreateIndex
CREATE INDEX "Question_userId_createdAt_idx" ON "Question"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Question_status_createdAt_idx" ON "Question"("status", "createdAt");

-- CreateIndex
CREATE INDEX "QuestionCard_cardId_idx" ON "QuestionCard"("cardId");

-- CreateIndex
CREATE INDEX "QuestionCard_faceId_idx" ON "QuestionCard"("faceId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionCard_questionId_position_key" ON "QuestionCard"("questionId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Ruling_questionId_key" ON "Ruling"("questionId");

-- CreateIndex
CREATE INDEX "RulingVersion_snapshotId_createdAt_idx" ON "RulingVersion"("snapshotId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "RulingVersion_rulingId_version_key" ON "RulingVersion"("rulingId", "version");

-- CreateIndex
CREATE INDEX "RulingCitation_ruleId_idx" ON "RulingCitation"("ruleId");

-- CreateIndex
CREATE INDEX "RulingCitation_cardFaceId_idx" ON "RulingCitation"("cardFaceId");

-- CreateIndex
CREATE INDEX "RulingCitation_rulingVersionId_idx" ON "RulingCitation"("rulingVersionId");

-- CreateIndex
CREATE INDEX "AppUser_role_createdAt_idx" ON "AppUser"("role", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AppUser_authProvider_providerSubject_key" ON "AppUser"("authProvider", "providerSubject");

-- CreateIndex
CREATE INDEX "Challenge_userId_createdAt_idx" ON "Challenge"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Challenge_status_createdAt_idx" ON "Challenge"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Challenge_rulingVersionId_idx" ON "Challenge"("rulingVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewEvent_correctedVersionId_key" ON "ReviewEvent"("correctedVersionId");

-- CreateIndex
CREATE INDEX "ReviewEvent_challengeId_createdAt_idx" ON "ReviewEvent"("challengeId", "createdAt");

-- CreateIndex
CREATE INDEX "ReviewEvent_reviewerId_createdAt_idx" ON "ReviewEvent"("reviewerId", "createdAt");

-- CreateIndex
CREATE INDEX "UsageWindow_principalHash_kind_windowStartedAt_idx" ON "UsageWindow"("principalHash", "kind", "windowStartedAt");

-- CreateIndex
CREATE INDEX "UsageWindow_userId_kind_windowStartedAt_idx" ON "UsageWindow"("userId", "kind", "windowStartedAt");

-- CreateIndex
CREATE INDEX "UsageWindow_windowEndsAt_idx" ON "UsageWindow"("windowEndsAt");

-- AddForeignKey
ALTER TABLE "SourceSnapshot" ADD CONSTRAINT "SourceSnapshot_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "DataSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rule" ADD CONSTRAINT "Rule_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "DataSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rule" ADD CONSTRAINT "Rule_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Rule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleCrossReference" ADD CONSTRAINT "RuleCrossReference_fromRuleId_fkey" FOREIGN KEY ("fromRuleId") REFERENCES "Rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleCrossReference" ADD CONSTRAINT "RuleCrossReference_toRuleId_fkey" FOREIGN KEY ("toRuleId") REFERENCES "Rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "DataSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardFace" ADD CONSTRAINT "CardFace_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AppUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionCard" ADD CONSTRAINT "QuestionCard_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionCard" ADD CONSTRAINT "QuestionCard_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionCard" ADD CONSTRAINT "QuestionCard_faceId_cardId_fkey" FOREIGN KEY ("faceId", "cardId") REFERENCES "CardFace"("id", "cardId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ruling" ADD CONSTRAINT "Ruling_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RulingVersion" ADD CONSTRAINT "RulingVersion_rulingId_fkey" FOREIGN KEY ("rulingId") REFERENCES "Ruling"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RulingVersion" ADD CONSTRAINT "RulingVersion_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "DataSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RulingCitation" ADD CONSTRAINT "RulingCitation_rulingVersionId_fkey" FOREIGN KEY ("rulingVersionId") REFERENCES "RulingVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RulingCitation" ADD CONSTRAINT "RulingCitation_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RulingCitation" ADD CONSTRAINT "RulingCitation_cardFaceId_fkey" FOREIGN KEY ("cardFaceId") REFERENCES "CardFace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Prisma models the nullable references; this check keeps the citation kind and target aligned.
ALTER TABLE "RulingCitation" ADD CONSTRAINT "RulingCitation_kind_target_check" CHECK (
    ("kind" = 'RULE' AND "ruleId" IS NOT NULL AND "cardFaceId" IS NULL)
    OR ("kind" = 'CARD' AND "ruleId" IS NULL AND "cardFaceId" IS NOT NULL)
);

-- AddForeignKey
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_rulingVersionId_fkey" FOREIGN KEY ("rulingVersionId") REFERENCES "RulingVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AppUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewEvent" ADD CONSTRAINT "ReviewEvent_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewEvent" ADD CONSTRAINT "ReviewEvent_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "AppUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewEvent" ADD CONSTRAINT "ReviewEvent_correctedVersionId_fkey" FOREIGN KEY ("correctedVersionId") REFERENCES "RulingVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageWindow" ADD CONSTRAINT "UsageWindow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
