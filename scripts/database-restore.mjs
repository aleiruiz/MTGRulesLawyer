import "dotenv/config";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { runPostgresTool, requireEnvironment } from "./postgres-client.mjs";

const startedAt = Date.now();
try {
  if (process.env.CONFIRM_DATABASE_RESTORE !== "YES") {
    throw new Error("Set CONFIRM_DATABASE_RESTORE=YES to confirm this destructive restore.");
  }
  const restoreUrl = requireEnvironment("RESTORE_DATABASE_URL");
  const backupFile = resolve(requireEnvironment("DB_BACKUP_FILE"));
  await access(backupFile);
  await runPostgresTool(
    "pg_restore",
    ["--clean", "--if-exists", "--no-owner", "--no-privileges", "--exit-on-error", backupFile],
    restoreUrl,
  );
  process.stdout.write(
    `${JSON.stringify({ event: "database.restore.completed", file: backupFile, durationMs: Date.now() - startedAt })}\n`,
  );
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({ event: "database.restore.failed", error: error instanceof Error ? error.message : "UnknownError" })}\n`,
  );
  process.exitCode = 1;
}
