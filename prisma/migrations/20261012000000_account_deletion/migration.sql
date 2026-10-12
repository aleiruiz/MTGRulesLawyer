-- Deleting an account keeps reviewed challenges and review events for the audit trail without a
-- link to the deleted user.
ALTER TABLE "Challenge" DROP CONSTRAINT "Challenge_userId_fkey";
ALTER TABLE "Challenge" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AppUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ReviewEvent" DROP CONSTRAINT "ReviewEvent_reviewerId_fkey";
ALTER TABLE "ReviewEvent" ALTER COLUMN "reviewerId" DROP NOT NULL;
ALTER TABLE "ReviewEvent" ADD CONSTRAINT "ReviewEvent_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "AppUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
