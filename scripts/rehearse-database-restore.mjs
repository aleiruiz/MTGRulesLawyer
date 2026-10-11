import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPostgresTool, requireEnvironment } from "./postgres-client.mjs";

const databaseUrl = requireEnvironment("DATABASE_URL");
if (process.env.CONFIRM_DATABASE_RESTORE !== "YES") {
  throw new Error(
    "The restore rehearsal requires CONFIRM_DATABASE_RESTORE=YES on a disposable database.",
  );
}

const directory = await mkdtemp(join(tmpdir(), "mtg-db-restore-rehearsal-"));
const backupFile = join(directory, "rehearsal.dump");
const probeTable = `ops_backup_rehearsal_${randomUUID().replaceAll("-", "")}`;
const expected = `saved-${randomUUID()}`;
let probeCreated = false;
const executeSql = (sql) =>
  runPostgresTool(
    "psql",
    ["--no-psqlrc", "--set=ON_ERROR_STOP=1", "--tuples-only", "--no-align", "--command", sql],
    databaseUrl,
  );

try {
  await executeSql(
    `CREATE TABLE public.${probeTable} (value text NOT NULL); INSERT INTO public.${probeTable} (value) VALUES ('${expected}');`,
  );
  probeCreated = true;
  await runPostgresTool(
    "pg_dump",
    ["--format=custom", "--no-owner", "--no-privileges", `--file=${backupFile}`],
    databaseUrl,
  );
  await executeSql(`UPDATE public.${probeTable} SET value = 'changed-after-backup';`);
  await runPostgresTool(
    "pg_restore",
    ["--clean", "--if-exists", "--no-owner", "--no-privileges", "--exit-on-error", backupFile],
    databaseUrl,
  );
  const restored = await executeSql(`SELECT value FROM public.${probeTable};`);
  if (restored !== expected)
    throw new Error("The restored database did not contain the backup probe value.");
  process.stdout.write(`${JSON.stringify({ event: "database.restore.rehearsal.completed" })}\n`);
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({ event: "database.restore.rehearsal.failed", error: error instanceof Error ? error.message : "UnknownError" })}\n`,
  );
  process.exitCode = 1;
} finally {
  if (probeCreated) await executeSql(`DROP TABLE public.${probeTable};`).catch(() => undefined);
  await rm(directory, { recursive: true, force: true });
}
