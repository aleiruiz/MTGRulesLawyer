-- Functional indexes are migration-managed because Prisma schema indexes do not
-- currently represent these PostgreSQL expression indexes.
CREATE INDEX "Rule_text_search_idx"
  ON "Rule" USING GIN (to_tsvector('english', "text"));

CREATE INDEX "CardFace_name_lower_idx"
  ON "CardFace" (lower("name"));
