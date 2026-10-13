-- The model, reasoning effort and failure reason of each AI call, for the admin usage dashboard.
CREATE TYPE "AiCallFailure" AS ENUM ('OUTPUT_LIMIT', 'TIMEOUT', 'CANCELLED', 'ERROR');

ALTER TABLE "AiUsageReservation"
  ADD COLUMN "model" TEXT,
  ADD COLUMN "reasoningEffort" TEXT,
  ADD COLUMN "failure" "AiCallFailure";
