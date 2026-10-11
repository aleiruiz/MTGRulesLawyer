import { spawn } from "node:child_process";
import { basename, dirname, resolve, sep } from "node:path";

const postgresEnvironmentKeys = [
  "PGHOST",
  "PGPORT",
  "PGDATABASE",
  "PGUSER",
  "PGPASSWORD",
  "PGSSLMODE",
  "PGSSLROOTCERT",
  "PGSSLCERT",
  "PGSSLKEY",
];

export function postgresConnectionEnv(connectionString) {
  const url = new URL(connectionString);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use the postgres:// or postgresql:// protocol.");
  }

  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!url.hostname || !database) throw new Error("DATABASE_URL must include a host and database.");

  const env = { ...process.env, PGHOST: url.hostname, PGDATABASE: database };
  if (url.port) env.PGPORT = url.port;
  if (url.username) env.PGUSER = decodeURIComponent(url.username);
  if (url.password) env.PGPASSWORD = decodeURIComponent(url.password);
  for (const option of ["sslmode", "sslrootcert", "sslcert", "sslkey"]) {
    const value = url.searchParams.get(option);
    if (value) env[`PG${option.slice(0, 4).toUpperCase()}${option.slice(4).toUpperCase()}`] = value;
  }
  return env;
}

export function postgresDatabaseName(connectionString) {
  const database = decodeURIComponent(new URL(connectionString).pathname.replace(/^\//, ""));
  if (!database) throw new Error("DATABASE_URL must include a database.");
  return database;
}

export function createPostgresToolInvocation(command, args, connectionString, dockerImage) {
  const env = postgresConnectionEnv(connectionString);
  if (!dockerImage) return { command, args, env };

  const certificatePathKeys = ["PGSSLROOTCERT", "PGSSLCERT", "PGSSLKEY"];
  if (certificatePathKeys.some((key) => env[key])) {
    throw new Error(
      "Dockerized PostgreSQL clients do not support file-based TLS certificates; install native PostgreSQL client tools instead.",
    );
  }

  if (["localhost", "127.0.0.1", "::1"].includes(env.PGHOST)) {
    env.PGHOST = "host.docker.internal";
  }

  const backupPathIndex =
    command === "pg_dump"
      ? args.findIndex((argument) => argument.startsWith("--file="))
      : command === "pg_restore"
        ? args.length - 1
        : -1;
  let mappedArgs = args;
  const dockerArgs = ["run", "--rm", "--add-host=host.docker.internal:host-gateway"];

  if (backupPathIndex >= 0) {
    const argument = args[backupPathIndex];
    const hasFileFlag = argument.startsWith("--file=");
    const hostPath = resolve(hasFileFlag ? argument.slice("--file=".length) : argument);
    const directory = dirname(hostPath);
    const containerPath = `/work/${basename(hostPath)}`;
    const mountSource = directory.split(sep).join("/");
    dockerArgs.push("--mount", `type=bind,source=${mountSource},target=/work`);
    mappedArgs = [...args];
    mappedArgs[backupPathIndex] = hasFileFlag ? `--file=${containerPath}` : containerPath;
  }

  for (const key of postgresEnvironmentKeys) {
    if (env[key] !== undefined) dockerArgs.push("--env", key);
  }
  dockerArgs.push(dockerImage, command, ...mappedArgs);
  return { command: "docker", args: dockerArgs, env };
}

export function runPostgresTool(command, args, connectionString) {
  const invocation = createPostgresToolInvocation(
    command,
    args,
    connectionString,
    process.env.POSTGRES_CLIENT_IMAGE?.trim(),
  );
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      env: invocation.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`${command} failed with exit code ${code}: ${stderr.trim()}`));
    });
  });
}

export function requireEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be set.`);
  return value;
}
