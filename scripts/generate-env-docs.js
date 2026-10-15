#!/usr/bin/env node
/**
 * Generates the environment-variable table in `docs/CONFIGURATION.md` from
 * `src/config/env.validation.ts` and `.env.example`.
 *
 * The table has to combine two sources, because neither is complete on its
 * own:
 *
 *   - `env.validation.ts` is authoritative for the *name*, *type*, *required*
 *     and *description* of every variable the app validates at boot. The
 *     descriptions are the `///` doc comments attached to each property.
 *   - `.env.example` is authoritative for the *default* value, including the
 *     commented-out ones that only apply once an optional feature is on.
 *
 * Because those two files drift independently, this script also fails when
 * they disagree: a variable added to one and not the other is reported
 * instead of being silently dropped from the table. `npm run docs:check`
 * runs it in --check mode so CI catches the drift.
 *
 * Four variables are read by ConfigService but deliberately not validated by
 * `env.validation.ts` (feature flags go through FeatureFlagsService, and the
 * scan guard has its own defaults). They are listed too, flagged as
 * unvalidated, because a typo in one of them fails silently.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const VALIDATION = path.join(ROOT, "src/config/env.validation.ts");
const ENV_EXAMPLE = path.join(ROOT, ".env.example");
const TARGET = path.join(ROOT, "docs/CONFIGURATION.md");

const BEGIN = "<!-- BEGIN GENERATED: env table (npm run docs:env) -->";
const END = "<!-- END GENERATED: env table -->";

/**
 * Read by ConfigService directly rather than validated at boot. Listed in
 * the table because they are real configuration, but marked unvalidated:
 * a typo fails silently instead of stopping the app.
 */
const UNVALIDATED = {
  SCAN_RATE_LIMIT_MAX: {
    type: "integer",
    description:
      "Scans allowed per window per device, for ticket check-in abuse " +
      "prevention. See docs/RATE_LIMITING.md.",
  },
  SCAN_RATE_LIMIT_WINDOW_MS: {
    type: "integer",
    description: "Length of the scan rate-limit window, in milliseconds.",
  },
  FEATURE_FEE_BUMP: {
    type: "boolean (string)",
    description:
      "Experimental: enable the fee-bump path. Off unless exactly 'true'. " +
      "See docs/FEATURE_FLAGS.md.",
  },
  FEATURE_INDEXER: {
    type: "boolean (string)",
    description:
      "Experimental: enable the chain indexer. Off unless exactly 'true'. " +
      "See docs/FEATURE_FLAGS.md.",
  },
};

/** Collapse a `///` comment block into a single line. */
function cleanDoc(lines) {
  return lines
    .map((l) => l.replace(/^\s*\/\/\/\s?/, "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Infer the documented type from the class-validator decorators. */
function typeFromDecorators(decorators) {
  const inList = decorators
    .map((d) => d.match(/@IsIn\(\[([^\]]*)\]/))
    .find(Boolean);
  if (inList) {
    const values = inList[1]
      .split(",")
      .map((v) => v.trim().replace(/^['"]|['"]$/g, ""))
      .filter(Boolean);
    return `\`${values.join(" | ")}\``;
  }
  const minLength = decorators
    .map((d) => d.match(/@MinLength\((\d+)\)/))
    .find(Boolean);
  if (decorators.includes("@IsInt()")) {
    return minLength ? "integer" : "integer";
  }
  if (minLength) return `string (min ${minLength[1]} chars)`;
  if (decorators.includes("@IsString()")) return "string";
  return "—";
}

/**
 * Parse the EnvironmentVariables class into records. Decorators sit between
 * the `///` block and the property, so all three are buffered and flushed
 * when the property line is reached.
 */
function parseValidation(src) {
  const classStart = src.indexOf("class EnvironmentVariables");
  if (classStart === -1) {
    throw new Error("Could not find `class EnvironmentVariables`");
  }
  const classEnd = src.indexOf("\n}", classStart);
  const body = src.slice(classStart, classEnd).split("\n");

  const records = [];
  let doc = [];
  let decorators = [];

  for (const line of body) {
    const docMatch = line.match(/^\s*\/\/\/\s?(.*)$/);
    if (docMatch) {
      doc.push(docMatch[1]);
      continue;
    }
    const decoratorMatch = line.match(/^\s*(@[A-Za-z]+)/);
    if (decoratorMatch) {
      // Collect a decorator line, including any continuation lines, so
      // multi-line @ValidateIf(...) blocks are not split.
      let text = line.trim();
      let depth = (text.match(/\(/g) || []).length - (text.match(/\)/g) || []).length;
      let idx = body.indexOf(line);
      while (depth > 0 && idx + 1 < body.length) {
        idx += 1;
        text += " " + body[idx].trim();
        depth +=
          (text.match(/\(/g) || []).length - (text.match(/\)/g) || []).length;
      }
      decorators.push(text.split("(")[0]);
      if (depth === 0) decorators[decorators.length - 1] = text;
      continue;
    }
    const propMatch = line.match(/^\s{2}([A-Z_][A-Z0-9_]*)([!?]):/);
    if (propMatch) {
      const [, name, marker] = propMatch;
      records.push({
        name,
        required: marker === "!" && !decorators.includes("@IsOptional"),
        conditional: decorators.some((d) => d.startsWith("@ValidateIf")),
        type: typeFromDecorators(decorators),
        description: cleanDoc(doc),
        decorators,
      });
      doc = [];
      decorators = [];
      continue;
    }
    // A blank line between a doc block and its property means the doc belongs
    // to nothing; drop it so descriptions never bleed onto the wrong field.
    if (!line.trim()) {
      doc = [];
      decorators = [];
    }
  }
  return records;
}

/**
 * Read `.env.example`, including commented-out lines like
 * `# WEBHOOK_QUEUE_ATTEMPTS=5`, which document the default for a variable
 * that is only meaningful once a feature is enabled.
 */
function parseEnvExample(src) {
  const out = new Map();
  for (const raw of src.split("\n")) {
    const line = raw.trim();
    const m = line.match(/^#?\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    const [, name, value] = m;
    // A commented line with no value is prose, not a default.
    if (value.trim() === "" && line.startsWith("#")) continue;
    out.set(name, { value: value.trim(), commented: line.startsWith("#") });
  }
  return out;
}

function escapeCell(text) {
  return String(text).replace(/\|/g, "\\|");
}

function buildTable(records, envExample) {
  const rows = [];

  for (const rec of records) {
    const ex = envExample.get(rec.name);
    // A conditionally-required variable has no fallback: if the related
    // feature is on and it is unset, boot fails. A commented-out value in
    // .env.example is a fallback or an example, not a live default, so mark
    // it and explain below the table.
    let source = "—";
    if (ex && ex.value !== "" && !rec.conditional) {
      source = `\`${ex.value}\`${ex.commented ? " \\*" : ""}`;
    }
    const requirement = rec.conditional
      ? "conditional"
      : rec.required
        ? "**required**"
        : "optional";
    const validation = rec.conditional ? "yes (when required)" : "yes";

    rows.push(
      "| " +
        [
          `\`${rec.name}\``,
          escapeCell(rec.type),
          requirement,
          source,
          validation,
          escapeCell(rec.description || "⚠️ missing description"),
        ].join(" | "),
    );
  }

  for (const [name, meta] of Object.entries(UNVALIDATED)) {
    const ex = envExample.get(name);
    const source =
      ex && ex.value !== "" ? `\`${ex.value}\`${ex.commented ? " \\*" : ""}` : "—";
    rows.push(
      "| " +
        [
          `\`${name}\``,
          escapeCell(meta.type),
          "optional",
          source,
          "**no**",
          escapeCell(meta.description),
        ].join(" | "),
    );
  }

  const header =
    "| Variable | Type | Required | Default | Validated at boot | Description |\n" +
    "| --- | --- | --- | --- | --- | --- |";

  const legend =
    "| \\* | | | | | The value used in code when the variable is unset. " +
    "Commented out in `.env.example` because it only applies once the " +
    "related optional feature is enabled. |";

  return `${header}\n${rows.join("\n")}\n${legend}`;
}

/**
 * Cross-check the two sources. Returns a list of human-readable problems;
 * an empty list means the table can be trusted.
 */
function findDrift(records, envExample) {
  const problems = [];
  const validated = new Set(records.map((r) => r.name));

  for (const name of validated) {
    if (!envExample.has(name)) {
      problems.push(
        `${name} is validated in env.validation.ts but missing from .env.example`,
      );
    }
  }

  for (const name of envExample.keys()) {
    if (!validated.has(name) && !(name in UNVALIDATED)) {
      problems.push(
        `${name} is in .env.example but neither validated nor listed in ` +
          `UNVALIDATED in scripts/generate-env-docs.js`,
      );
    }
  }

  for (const rec of records) {
    if (!rec.description) {
      problems.push(
        `${rec.name} has no \`///\` description in env.validation.ts, so it ` +
          `cannot be documented`,
      );
    }
  }

  return problems;
}

function main() {
  const check = process.argv.includes("--check");

  const records = parseValidation(fs.readFileSync(VALIDATION, "utf-8"));
  const envExample = parseEnvExample(fs.readFileSync(ENV_EXAMPLE, "utf-8"));
  const problems = findDrift(records, envExample);

  if (problems.length) {
    console.error("env docs are out of date:\n");
    for (const p of problems) console.error(`  - ${p}`);
    console.error(
      "\nRun `npm run docs:env` after fixing .env.example / env.validation.ts.",
    );
    process.exit(1);
  }

  const table = buildTable(records, envExample);
  const current = fs.readFileSync(TARGET, "utf-8");

  const begin = current.indexOf(BEGIN);
  const end = current.indexOf(END);
  if (begin === -1 || end === -1) {
    console.error(
      `Could not find the generated markers in ${path.relative(ROOT, TARGET)}.`,
    );
    process.exit(1);
  }

  const next =
    current.slice(0, begin + BEGIN.length) +
    "\n\n" +
    table +
    "\n\n" +
    current.slice(end);

  if (next === current) {
    console.log("env docs are up to date");
    return;
  }

  if (check) {
    console.error(
      `docs/CONFIGURATION.md is out of date. Run \`npm run docs:env\`.`,
    );
    process.exit(1);
  }

  fs.writeFileSync(TARGET, next);
  console.log(
    `Wrote ${records.length} validated + ${Object.keys(UNVALIDATED).length} ` +
      `unvalidated variables to ${path.relative(ROOT, TARGET)}`,
  );
}

main();
