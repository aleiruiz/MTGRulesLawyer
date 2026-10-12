-- Characteristics the judge needs to reason about cards (mana value, loyalty, defense).
ALTER TABLE "Card" ADD COLUMN "manaValue" DOUBLE PRECISION;
ALTER TABLE "CardFace" ADD COLUMN "loyalty" TEXT;
ALTER TABLE "CardFace" ADD COLUMN "defense" TEXT;
