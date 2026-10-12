-- Approximate card-name lookup (typos, partial names) uses pg_trgm similarity.
-- Supabase Postgres ships pg_trgm, and its dashboard installs extensions in the "extensions"
-- schema; the search path below finds the operator class either way. This index is managed
-- here, outside schema.prisma.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
SET search_path = public, extensions;

CREATE INDEX "CardFace_name_trgm_idx" ON "CardFace" USING GIN (lower("name") gin_trgm_ops);
