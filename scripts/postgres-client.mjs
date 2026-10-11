import { spawn } from "node:child_process";

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

export function runPostgresTool(command, args, connectionString) {
  const env = postgresConnectionEnv(connectionString);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
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
