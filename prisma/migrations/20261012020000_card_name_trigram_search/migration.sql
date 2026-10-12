-- Approximate card-name lookup (typos, partial names) uses pg_trgm similarity.
-- Supabase Postgres ships pg_trgm; this index is managed here, outside schema.prisma.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "CardFace_name_trgm_idx" ON "CardFace" USING GIN (lower("name") gin_trgm_ops);
