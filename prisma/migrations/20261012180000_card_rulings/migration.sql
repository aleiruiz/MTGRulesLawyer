-- AlterEnum
ALTER TYPE "CitationKind" ADD VALUE 'CARD_RULING';

-- CreateTable
CREATE TABLE "CardRuling" (
    "id" UUID NOT NULL,
    "cardId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "publishedAt" DATE NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "CardRuling_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CardRuling_cardId_position_key" ON "CardRuling"("cardId", "position");

-- AddForeignKey
ALTER TABLE "CardRuling" ADD CONSTRAINT "CardRuling_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "RulingCitation" ADD COLUMN "cardRulingId" UUID;

-- CreateIndex
CREATE INDEX "RulingCitation_cardRulingId_idx" ON "RulingCitation"("cardRulingId");

-- AddForeignKey
ALTER TABLE "RulingCitation" ADD CONSTRAINT "RulingCitation_cardRulingId_fkey" FOREIGN KEY ("cardRulingId") REFERENCES "CardRuling"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Each citation kind points at exactly one target. The new enum value cannot be used as a
-- literal in the transaction that adds it, so the check compares the kind as text.
ALTER TABLE "RulingCitation" DROP CONSTRAINT "RulingCitation_kind_target_check";
ALTER TABLE "RulingCitation" ADD CONSTRAINT "RulingCitation_kind_target_check" CHECK (
    ("kind"::text = 'RULE' AND "ruleId" IS NOT NULL AND "cardFaceId" IS NULL AND "cardRulingId" IS NULL)
    OR ("kind"::text = 'CARD' AND "ruleId" IS NULL AND "cardFaceId" IS NOT NULL AND "cardRulingId" IS NULL)
    OR ("kind"::text = 'CARD_RULING' AND "ruleId" IS NULL AND "cardFaceId" IS NULL AND "cardRulingId" IS NOT NULL)
);
