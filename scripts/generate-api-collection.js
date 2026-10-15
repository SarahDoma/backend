#!/usr/bin/env node
/**
 * Generates a Bruno API collection under `docs/bruno/` from the NestJS
 * controllers in `src/`.
 *
 * Request bodies are derived from the DTOs, so the shape of each body in the
 * collection tracks the validation the API actually enforces rather than
 * being hand-maintained and quietly going stale. Values that cannot be
 * invented (Stellar public keys) are emitted as Bruno variables the caller
 * fills in from the environment.
 *
 * Regenerate with `npm run docs:api`; `npm run docs:check` fails if the
 * committed collection no longer matches the controllers.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");
const OUT = path.join(ROOT, "docs/bruno");
const SCHEMA = path.join(ROOT, "prisma/schema.prisma");

const HTTP_METHODS = ["Get", "Post", "Put", "Patch", "Delete"];

/**
 * A fixed, obviously-future timestamp for date fields.
 *
 * This has to be a constant rather than `new Date()`: generation has to be
 * deterministic, or `docs:check` reports the collection as out of date on
 * every run and CI can never go green.
 */
const PLACEHOLDER_DATE = "2030-01-01T18:00:00.000Z";

/**
 * Example values keyed by field name, for fields whose validator only says
 * "string" but where a generic placeholder would be useless in a collection
 * someone is about to send real requests from.
 */
const NAME_EXAMPLES = {
  password: "correct-horse-battery-staple",
  name: "Launch Night",
  title: "Launch Night",
  email: "you@example.com",
  description: "A short description.",
  slug: "launch-night",
  venue: "The Fillmore",
  address: "1 Market St, San Francisco",
  city: "San Francisco",
  country: "US",
  url: "https://example.com/webhook",
  webhookUrl: "https://example.com/webhook",
  secret: "whsec_example",
  label: "Front Door",
  reason: "Test",
  comment: "Test comment",
  scannedAt: "Gate scanner 1",
  deviceName: "Front Door Scanner",
};

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Read a balanced `(...)` group starting at `i`, which must point at `(`. */
function readParens(src, i) {
  let depth = 0;
  for (let j = i; j < src.length; j += 1) {
    if (src[j] === "(") depth += 1;
    else if (src[j] === ")") {
      depth -= 1;
      if (depth === 0) return { end: j + 1, text: src.slice(i + 1, j) };
    }
  }
  return null;
}

/** Read a balanced `{...}` group starting at `i`, which must point at `{`. */
function readBraces(src, i) {
  let depth = 0;
  for (let j = i; j < src.length; j += 1) {
    if (src[j] === "{") depth += 1;
    else if (src[j] === "}") {
      depth -= 1;
      if (depth === 0) return { end: j + 1, text: src.slice(i + 1, j) };
    }
  }
  return null;
}

/** Pull `enum X { A, B }` bodies out of the Prisma schema. */
function parsePrismaEnums() {
  const src = fs.readFileSync(SCHEMA, "utf-8");
  const enums = {};
  const re = /enum\s+(\w+)\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(src))) {
    enums[m[1]] = m[2]
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("//") && !l.startsWith("@@"))
      .map((l) => l.replace(/\s.*$/, ""))
      .filter(Boolean);
  }
  return enums;
}

/** Index every exported class in src by name, for DTO resolution. */
function buildClassIndex() {
  const files = walk(SRC).filter((f) => f.endsWith(".ts") && !f.endsWith(".spec.ts"));
  const index = new Map();
  for (const file of files) {
    const src = fs.readFileSync(file, "utf-8");
    const classRe = /export (?:class|abstract class)\s+(\w+)/g;
    let m;
    while ((m = classRe.exec(src))) index.set(m[1], { file, src });
  }
  return index;
}

/**
 * Parse a DTO class into field records.
 *
 * This is a hand-rolled scanner rather than a regex because the decorator
 * arguments in this codebase nest arbitrarily — `@Type(() => Date)`,
 * `@IsEnum(Industry, { message: `...${Object.values(Industry).join(', ')}` })`.
 * A regex silently drops any field whose decorators contain nested parens,
 * which is how `category` and `startsAt` went missing from the first draft of
 * this generator.
 */
function parseDto(src, className) {
  const start = src.indexOf(`class ${className}`);
  if (start === -1) return null;
  const open = src.indexOf("{", start);
  const body = readBraces(src, open);
  if (!body) return null;

  const fields = [];
  let decorators = [];
  let i = 0;

  while (i < body.text.length) {
    const ch = body.text[i];

    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    // Comments are documentation, not structure.
    if (ch === "/" && body.text[i + 1] === "/") {
      const nl = body.text.indexOf("\n", i);
      i = nl === -1 ? body.text.length : nl;
      continue;
    }
    if (ch === "/" && body.text[i + 1] === "*") {
      const close = body.text.indexOf("*/", i);
      i = close === -1 ? body.text.length : close + 2;
      continue;
    }

    if (ch === "@") {
      const nameMatch = /^@([A-Za-z]+)/.exec(body.text.slice(i));
      if (nameMatch) {
        let j = i + nameMatch[0].length;
        while (j < body.text.length && /\s/.test(body.text[j])) j += 1;
        let args = "";
        if (body.text[j] === "(") {
          const r = readParens(body.text, j);
          if (r) {
            args = r.text;
            j = r.end;
          }
        }
        decorators.push({ name: nameMatch[1], args });
        i = j;
        continue;
      }
    }

    const propMatch = /^([a-zA-Z_][a-zA-Z0-9_]*)(\??)\s*[!?]?\s*:/.exec(
      body.text.slice(i),
    );
    if (propMatch) {
      let j = i + propMatch[0].length;
      const typeStart = j;
      let depth = 0;
      while (j < body.text.length) {
        const c = body.text[j];
        if ("{(<[".includes(c)) depth += 1;
        else if ("})>]".includes(c)) depth -= 1;
        else if ((c === ";" || c === "\n") && depth <= 0) break;
        j += 1;
      }
      const type = body.text.slice(typeStart, j).trim().replace(/;$/, "");

      fields.push({
        name: propMatch[1],
        optional: propMatch[2] === "?" || decorators.some((d) => d.name === "IsOptional"),
        decorators,
        type,
      });
      decorators = [];
      i = j + 1;
      continue;
    }

    i += 1;
  }

  return { name: className, fields };
}

function has(field, name) {
  return field.decorators.some((d) => d.name === name);
}

function argOf(field, name) {
  const d = field.decorators.find((x) => x.name === name);
  return d ? d.args : null;
}

/** Build a plausible example for a slash-delimited regex fragment. */
function exampleForPattern(fragment) {
  if (fragment.includes("{64}")) return "a".repeat(64);
  if (fragment.includes("[A-Z0-9_-]")) return "PROMO-CODE_1";
  if (fragment.includes("a-f0-9")) return "a".repeat(64);
  if (fragment.includes("a-z0-9")) return "my-slug";
  return "string";
}

/**
 * Example value for one DTO field, honouring the validators present. Returns
 * a JSON-ready value; nested DTOs are recursed into so the body shows the
 * real shape rather than a bare `{}`.
 */
function exampleFor(field, ctx, seen) {
  const { enums, classes } = ctx;

  const enumArg = argOf(field, "IsEnum");
  if (enumArg) {
    const name = enumArg.match(/^(\w+)/);
    const values = name && enums[name[1]];
    if (values && values.length) return values[0];
  }

  // @Type(() => X): Date becomes an ISO string, a DTO becomes a filled object.
  const typeArg = argOf(field, "Type");
  if (typeArg) {
    const target = typeArg.match(/=>\s*(\w+)/);
    if (target && target[1] === "Date") {
      return PLACEHOLDER_DATE;
    }
    if (target && target[1] !== "String" && target[1] !== "Number") {
      if (!seen.has(target[1])) {
        seen.add(target[1]);
        const nested = expandDto(target[1], ctx, seen);
        if (has(field, "IsArray")) return [nested];
        return nested;
      }
      return has(field, "IsArray") ? [] : {};
    }
  }

  if (has(field, "IsBoolean")) return true;

  if (has(field, "IsInt") || has(field, "IsNumber")) {
    const minArg = argOf(field, "Min");
    const maxArg = argOf(field, "Max");
    const min = minArg ? Number(minArg.replace(/[_\s]/g, "")) : null;
    const max = maxArg ? Number(maxArg.replace(/[_\s]/g, "")) : null;
    let n = min !== null ? min : 1;
    if (max !== null && n > max) n = max;
    if (min !== null && min > 0 && n === 0) n = min;
    return n;
  }

  if (has(field, "IsPositive")) return 1;
  if (has(field, "IsEmail")) return "you@example.com";
  if (has(field, "IsUrl")) return "https://example.com/webhook";
  if (has(field, "IsDateString") || has(field, "IsDate")) {
    return PLACEHOLDER_DATE;
  }
  if (has(field, "IsStellarPublicKey")) return "{{publicKey}}";
  if (has(field, "IsBigIntString")) return "0";
  if (has(field, "IsUUID")) return "00000000-0000-4000-8000-000000000000";
  if (has(field, "IsArray")) {
    const itemType = (typeArg || "").match(/Array<\s*(\w+)/);
    if (itemType && itemType[1] !== "String" && itemType[1] !== "Number") {
      if (!seen.has(itemType[1])) {
        seen.add(itemType[1]);
        return [expandDto(itemType[1], ctx, seen)];
      }
    }
    return [];
  }

  const matchesArg = argOf(field, "Matches");
  if (matchesArg) {
    const frag = matchesArg.match(/\/\^?([^/"]+)\/?[a-z]*\//);
    if (frag) return exampleForPattern(frag[1]);
  }

  // A named field beats a generic filler, but must still satisfy MinLength.
  const minLength = argOf(field, "MinLength");
  const min = minLength ? Number(minLength) : 0;
  const named = NAME_EXAMPLES[field.name];
  if (named) {
    return named.length >= min ? named : named + "x".repeat(min - named.length);
  }

  if (min > 0) return "x".repeat(min);

  return "string";
}

/** Recursively build a body object for a DTO class name. */
function expandDto(className, ctx, seen) {
  const entry = ctx.classes.get(className);
  if (!entry) return {};
  const parsed = parseDto(entry.src, className);
  if (!parsed) return {};
  const out = {};
  for (const field of parsed.fields) {
    out[field.name] = exampleFor(field, ctx, seen);
  }
  return out;
}

/** Parse every controller into `{ area, routes }` groups. */
function parseControllers() {
  const files = walk(SRC).filter(
    (f) => f.endsWith(".controller.ts") && !f.endsWith(".spec.ts"),
  );
  const groups = [];

  for (const file of files.sort()) {
    const src = fs.readFileSync(file, "utf-8");
    // `@Controller()` takes no argument for a bare prefix, so the quoted form
    // is optional; skipping the unquoted one drops every route in
    // events.controller.ts and app.controller.ts.
    const prefixMatch = src.match(/@Controller\(\s*(?:['"]([^'"]*)['"])?\s*\)/);
    if (!prefixMatch) continue;
    const prefix = prefixMatch[1] || "";

    // A class-level guard applies to every route in the file. It is written
    // *after* @Controller, between the decorator and `export class`.
    const classDecl = src.indexOf("export class", prefixMatch.index);
    const classGuard =
      classDecl !== -1 &&
      /@UseGuards\(\s*\w+/.test(src.slice(prefixMatch.index, classDecl));

    const routes = [];
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const m = lines[i].match(
        new RegExp(`@(${HTTP_METHODS.join("|")})\\(\\s*['"]?([^'")]*)['"]?\\s*\\)`),
      );
      if (!m) continue;

      let guarded = classGuard;
      let hasBody = false;
      let dtoName = null;
      let handler = "";

      for (let j = i + 1; j < Math.min(i + 18, lines.length); j += 1) {
        if (new RegExp(`@(Get|Post|Put|Patch|Delete)\\(`).test(lines[j])) break;
        if (/@UseGuards\(/.test(lines[j])) guarded = true;
        if (lines[j].includes("@Body()")) hasBody = true;
        const dto = lines[j].match(/dto:\s*(\w+)/);
        if (dto) dtoName = dto[1];
        const h = lines[j].match(/^\s*(?:async\s+)?([A-Za-z0-9_]+)\s*\(/);
        if (h && !handler) handler = h[1];
      }

      let full = (prefix ? `/${prefix}` : "") + (m[2].trim() ? `/${m[2].trim()}` : "");
      full = full.replace(/\/+/g, "/").replace(/\/$/, "") || "/";

      routes.push({ method: m[1].toUpperCase(), path: full, guarded, hasBody, dtoName, handler });
    }

    if (routes.length) {
      const rel = path.relative(SRC, file).replace(/\.controller\.ts$/, "");
      const parts = rel.split("/");
      // `waitlist/waitlist.controller.ts` -> `waitlist`, not `waitlist-waitlist`.
      const area =
        parts.length > 1 && parts[parts.length - 1] === parts[parts.length - 2]
          ? parts.slice(0, -1).join(" ")
          : parts.join(" ");
      groups.push({ area, file, routes });
    }
  }
  return groups;
}

/** `:organizationId` -> `{{organizationId}}`, so paths are filled from the env. */
function bruUrl(routePath) {
  return routePath.replace(/:([A-Za-z0-9_]+)/g, "{{$1}}");
}

function titleOf(route) {
  if (!route.handler) return `${route.method} ${route.path}`;
  return route.handler
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

function bruRequest(route, ctx) {
  const lines = [];
  lines.push("meta {");
  lines.push(`  name: ${titleOf(route)}`);
  lines.push("  type: http");
  lines.push("}");
  lines.push("");
  lines.push(`${route.method.toLowerCase()} {`);
  lines.push(`  url: {{baseUrl}}/v1${bruUrl(route.path)}`);
  if (route.hasBody) lines.push("  body: json");
  if (route.guarded) lines.push("  auth: bearer");
  lines.push("}");

  if (route.guarded) {
    lines.push("");
    lines.push("auth:bearer {");
    lines.push("  token: {{accessToken}}");
    lines.push("}");
  }

  if (route.hasBody) {
    const body = route.dtoName
      ? expandDto(route.dtoName, ctx, new Set([route.dtoName]))
      : {};
    if (Object.keys(body).length) {
      lines.push("");
      lines.push("body:json {");
      lines.push(
        JSON.stringify(body, null, 2)
          .split("\n")
          .map((l) => `  ${l}`)
          .join("\n"),
      );
      lines.push("}");
    }
  }

  return lines.join("\n") + "\n";
}

function generate() {
  const enums = parsePrismaEnums();
  const classes = buildClassIndex();
  const ctx = { enums, classes };
  const groups = parseControllers();

  const files = new Map();
  let requestCount = 0;

  for (const group of groups) {
    for (const route of group.routes) {
      const dir = group.area.replace(/\s+/g, "-");
      files.set(`${dir}/${titleOf(route)}.bru`, bruRequest(route, ctx));
      requestCount += 1;
    }
  }

  return { files, requestCount };
}

function main() {
  const check = process.argv.includes("--check");
  const { files, requestCount } = generate();

  if (!check) {
    for (const [rel, content] of files) {
      const full = path.join(OUT, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
    const areas = new Set([...files.keys()].map((f) => f.split("/")[0]));
    console.log(
      `Wrote ${requestCount} requests across ${areas.size} areas to docs/bruno/`,
    );
    return;
  }

  const mismatches = [];
  for (const [rel, content] of files) {
    const full = path.join(OUT, rel);
    if (!fs.existsSync(full)) {
      mismatches.push(`${rel} (missing)`);
      continue;
    }
    const onDisk = fs.readFileSync(full, "utf-8").trim();
    if (onDisk !== content.trim()) mismatches.push(`${rel} (out of date)`);
  }

  if (mismatches.length) {
    console.error("Bruno collection is out of date:\n");
    for (const m of mismatches) console.error(`  - ${m}`);
    console.error("\nRun `npm run docs:api`.");
    process.exit(1);
  }

  console.log(`Bruno collection up to date (${requestCount} requests)`);
}

main();
