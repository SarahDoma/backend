#!/usr/bin/env node
/**
 * Runs `npm audit` against production dependencies only and fails the
 * build if any vulnerability at or above the configured threshold is
 * found, unless it's on the allowlist.
 *
 * Allowlisting a vulnerability is a deliberate, reviewed exception (e.g.
 * no fix is available yet and the affected code path is unused) — add its
 * GHSA id to `scripts/audit-allowlist.json` along with a reason.
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const THRESHOLD = "high"; // fails on "high" or "critical" findings
const SEVERITY_RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const ALLOWLIST_PATH = path.join(__dirname, "audit-allowlist.json");

function loadAllowlist() {
  if (!fs.existsSync(ALLOWLIST_PATH)) return {};
  const entries = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, "utf-8"));
  return Object.fromEntries(entries.map((e) => [e.id, e.reason]));
}

function runAudit() {
  try {
    const output = execSync("npm audit --omit=dev --json", {
      encoding: "utf-8",
      maxBuffer: 1024 * 1024 * 20,
    });
    return JSON.parse(output);
  } catch (error) {
    // npm audit exits non-zero when vulnerabilities are found; the JSON
    // report is still on stdout.
    if (error.stdout) {
      return JSON.parse(error.stdout);
    }
    throw error;
  }
}

/**
 * Collects the advisory ids behind a finding. `npm audit` reports a package
 * that is only vulnerable through a dependency with the dependency's *name*
 * in `via`, not the advisory, so follow those names down to the advisories
 * that actually caused the finding. An allowlisted advisory then clears
 * every package it reached.
 */
function advisoryIds(advisory, vulnerabilities, seen = new Set()) {
  const ids = [];
  for (const via of advisory.via ?? []) {
    if (typeof via === "object" && via.source) {
      ids.push(String(via.source));
    } else if (typeof via === "string" && !seen.has(via) && vulnerabilities[via]) {
      seen.add(via);
      ids.push(...advisoryIds(vulnerabilities[via], vulnerabilities, seen));
    }
  }
  return ids;
}

function main() {
  const allowlist = loadAllowlist();
  const report = runAudit();
  const vulnerabilities = report.vulnerabilities ?? {};
  const advisories = Object.values(vulnerabilities);

  const failures = [];
  for (const advisory of advisories) {
    const severity = advisory.severity;
    if ((SEVERITY_RANK[severity] ?? 0) < SEVERITY_RANK[THRESHOLD]) continue;

    const ids = advisoryIds(advisory, vulnerabilities);

    const allAllowlisted = ids.length > 0 && ids.every((id) => allowlist[id]);
    if (allAllowlisted) continue;

    failures.push({ name: advisory.name, severity, ids });
  }

  if (failures.length > 0) {
    console.error(
      `npm audit found ${failures.length} vulnerabilit${failures.length === 1 ? "y" : "ies"} at or above "${THRESHOLD}":`,
    );
    for (const failure of failures) {
      console.error(
        `  - ${failure.name} [${failure.severity}] (advisory ids: ${failure.ids.join(", ") || "n/a"})`,
      );
    }
    console.error(
      "\nFix the dependency, or add the advisory id to scripts/audit-allowlist.json with a documented reason.",
    );
    process.exit(1);
  }

  console.log(`npm audit: no unallowlisted vulnerabilities at or above "${THRESHOLD}".`);
}

main();
