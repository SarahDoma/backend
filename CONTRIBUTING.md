# Contributing to StellarTickets/backend

## Development setup

```bash
npm install      # also runs `husky` via the `prepare` script — installs the pre-commit hook
cp .env.example .env
npx prisma migrate dev
npm run start:dev
```

## Pre-commit hook (husky + lint-staged)

A [husky](https://typicode.github.io/husky/) pre-commit hook runs
[lint-staged](https://github.com/lint-staged/lint-staged) automatically
whenever you commit. It applies ESLint (`--fix`) and Prettier to every
staged `.ts` file, so formatting issues never reach a PR.

The hook is installed by `npm install` via the `prepare` lifecycle script.
If you cloned the repo without running `npm install` first, or you need to
reinstall the hook manually, run:

```bash
npx husky
```

The hook configuration lives in `.husky/pre-commit` and the
`lint-staged` key in `package.json`.

To bypass the hook for an exceptional commit (e.g. a work-in-progress
checkpoint), use:

```bash
git commit --no-verify -m "wip: ..."
```

Use `--no-verify` sparingly — CI will still enforce lint and formatting
on every PR.

## Before opening a PR

```bash
npx tsc --noEmit
npx eslint "src/**/*.ts"
npm run audit:check
npm test
npm run build
```

## Dependency audit policy

CI runs `npm run audit:check`, which runs `npm audit --omit=dev` and fails
the build on any **high** or **critical** severity vulnerability in a
production dependency. Advisories below that threshold (low, moderate) do
not fail the build.

If a high/critical advisory has no fix available yet and the affected code
path isn't reachable, add its GHSA id to `scripts/audit-allowlist.json`
with a documented reason instead of ignoring the failure.

## Commit style

Keep commits scoped to one logical change with an imperative subject
line.
