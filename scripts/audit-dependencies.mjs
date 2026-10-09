import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const audit = spawnSync("pnpm", ["audit", "--json"], {
  encoding: "utf8",
  shell: process.platform === "win32",
});

let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  process.stderr.write(
    audit.stderr || audit.stdout || "pnpm audit did not return a JSON report.\n",
  );
  process.exit(1);
}

const exceptions = JSON.parse(
  await readFile(new URL("../audit-exceptions.json", import.meta.url), "utf8"),
);
const exceptionIds = new Set(exceptions.map(({ id }) => id));
const highOrCritical = Object.values(report.advisories ?? {}).filter(({ severity }) =>
  ["high", "critical"].includes(severity),
);
const foundIds = new Set(highOrCritical.map(({ github_advisory_id }) => github_advisory_id));
const unresolved = highOrCritical.filter(
  ({ github_advisory_id }) => !exceptionIds.has(github_advisory_id),
);
const stale = exceptions.filter(({ id }) => !foundIds.has(id));

for (const advisory of highOrCritical.filter(({ github_advisory_id }) =>
  exceptionIds.has(github_advisory_id),
)) {
  const exception = exceptions.find(({ id }) => id === advisory.github_advisory_id);
  process.stderr.write(
    `Allowed upstream advisory ${advisory.github_advisory_id} (${advisory.module_name}): ${exception.reason}\n`,
  );
}

if (unresolved.length > 0 || stale.length > 0) {
  for (const { github_advisory_id, module_name, severity, title } of unresolved) {
    process.stderr.write(
      `Unapproved ${severity} advisory ${github_advisory_id} in ${module_name}: ${title}\n`,
    );
  }
  for (const { id } of stale) {
    process.stderr.write(`Remove stale dependency audit exception ${id}.\n`);
  }
  process.exit(1);
}

process.stdout.write(
  `Dependency audit passed: ${report.metadata.vulnerabilities.high} high and ${report.metadata.vulnerabilities.critical} critical advisories checked; all high or critical findings are explicitly tracked.\n`,
);
