-- Printed card names in other languages (Spanish first), so card lookup also matches them.
ALTER TYPE "SourceKind" ADD VALUE 'LOCALIZED_CARD_NAMES';

CREATE TABLE "CardLocalizedName" (
    "id" UUID NOT NULL,
    "oracleId" TEXT NOT NULL,
    "faceIndex" INTEGER NOT NULL,
    "language" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardLocalizedName_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CardLocalizedName_language_oracleId_faceIndex_name_key"
    ON "CardLocalizedName"("language", "oracleId", "faceIndex", "name");
CREATE INDEX "CardLocalizedName_oracleId_idx" ON "CardLocalizedName"("oracleId");

-- Exact lookups compare lower("name"); approximate ones use trigram similarity like CardFace.
-- These expression indexes are managed here, outside schema.prisma.
SET search_path = public, extensions;
CREATE INDEX "CardLocalizedName_lower_name_idx" ON "CardLocalizedName"(lower("name"));
CREATE INDEX "CardLocalizedName_name_trgm_idx"
    ON "CardLocalizedName" USING GIN (lower("name") gin_trgm_ops);
