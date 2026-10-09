import "dotenv/config";
import { spawnSync } from "node:child_process";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  process.stderr.write("Set DATABASE_URL to the local PostgreSQL database before resetting it.\n");
  process.exit(1);
}

const databaseHost = new URL(databaseUrl).hostname;
if (!new Set(["localhost", "127.0.0.1", "::1"]).has(databaseHost)) {
  process.stderr.write(`Refusing to reset non-local database host '${databaseHost}'.\n`);
  process.exit(1);
}

const result = spawnSync("pnpm", ["exec", "prisma", "migrate", "reset", "--force"], {
  encoding: "utf8",
  shell: process.platform === "win32",
  stdio: "inherit",
});

process.exitCode = result.status ?? 1;
