-- Approximate card-name lookup falls back to edit distance (fuzzystrmatch) when trigram
-- similarity finds nothing: a swapped vowel ("Tormagoyf") shares too few trigrams with the
-- real name. Supabase Postgres ships fuzzystrmatch; its dashboard installs extensions in the
-- "extensions" schema, which the lookup's search path covers.
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;
