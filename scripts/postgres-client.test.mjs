import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPostgresToolInvocation } from "./postgres-client.mjs";

const connectionString = "postgresql://local-user:local-password@localhost:5432/mtg_rules_lawyer";

test("uses native PostgreSQL clients when no Docker image is configured", () => {
  const invocation = createPostgresToolInvocation("psql", ["--version"], connectionString);

  assert.equal(invocation.command, "psql");
  assert.deepEqual(invocation.args, ["--version"]);
  assert.equal(invocation.env.PGHOST, "localhost");
});

test("runs PostgreSQL clients in Docker without exposing credentials in arguments", () => {
  const backupPath = join(tmpdir(), "mtg-backup.dump");
  const invocation = createPostgresToolInvocation(
    "pg_dump",
    ["--format=custom", `--file=${backupPath}`],
    connectionString,
    "postgres:17-alpine",
  );
  const containerFileArgument = invocation.args.at(-1);

  assert.equal(invocation.command, "docker");
  assert.equal(invocation.env.PGHOST, "host.docker.internal");
  assert.equal(invocation.env.PGPASSWORD, "local-password");
  assert.match(invocation.args.join(" "), /postgres:17-alpine pg_dump --format=custom/);
  assert.match(containerFileArgument, /^--file=\/work\/mtg-backup\.dump$/);
  assert.ok(!invocation.args.join(" ").includes("local-password"));
});

test("maps pg_restore backup paths into the mounted directory", () => {
  const backupPath = join(tmpdir(), "mtg-restore.dump");
  const invocation = createPostgresToolInvocation(
    "pg_restore",
    ["--dbname", "mtg_rules_lawyer", "--exit-on-error", backupPath],
    connectionString,
    "postgres:17-alpine",
  );

  assert.equal(invocation.args.at(-1), "/work/mtg-restore.dump");
  assert.match(invocation.args.join(" "), /--mount type=bind,source=.*target=\/work/);
});

test("requires native tools when Dockerized clients would need TLS files", () => {
  assert.throws(
    () =>
      createPostgresToolInvocation(
        "psql",
        ["--version"],
        "postgresql://user:password@db.example:5432/app?sslrootcert=C%3A%2Fcerts%2Froot.crt",
        "postgres:17-alpine",
      ),
    /do not support file-based TLS certificates/,
  );
});
