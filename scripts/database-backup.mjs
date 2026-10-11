import "dotenv/config";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { runPostgresTool, requireEnvironment } from "./postgres-client.mjs";

const startedAt = Date.now();
const databaseUrl = requireEnvironment("DATABASE_URL");
const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const outputFile = resolve(
  process.env.DB_BACKUP_FILE?.trim() || `.backups/mtg-rules-${timestamp}.dump`,
);

try {
  await mkdir(dirname(outputFile), { recursive: true });
  await runPostgresTool(
    "pg_dump",
    ["--format=custom", "--no-owner", "--no-privileges", `--file=${outputFile}`],
    databaseUrl,
  );
  process.stdout.write(
    `${JSON.stringify({ event: "database.backup.completed", file: outputFile, durationMs: Date.now() - startedAt })}\n`,
  );
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({ event: "database.backup.failed", error: error instanceof Error ? error.message : "UnknownError" })}\n`,
  );
  process.exitCode = 1;
}
