DROP INDEX "AppUser_authProvider_providerSubject_key";

ALTER TABLE "AppUser" RENAME COLUMN "providerSubject" TO "supabaseUserId";
ALTER TABLE "AppUser" DROP COLUMN "authProvider";
DROP TYPE "AuthProvider";

CREATE UNIQUE INDEX "AppUser_supabaseUserId_key" ON "AppUser"("supabaseUserId");
