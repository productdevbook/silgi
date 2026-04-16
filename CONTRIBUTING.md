# Contributing to Silgi

Thanks for your interest in Silgi. This guide covers the local workflow,
the tools we expect you to have installed, and the shape of a good patch.

## Prerequisites

- **Node.js `>=24`** — we rely on modern V8 features (native `using`,
  `AsyncLocalStorage` refinements, `--experimental-strip-types`).
- **pnpm `>=10`** — the workspace is a pnpm-managed monorepo. Corepack is
  the recommended way to get the right version:
  ```bash
  corepack enable
  corepack prepare pnpm@latest-10 --activate
  ```
- **Bun** (optional) — only needed if you want to run the Bun-compat suite
  locally (`bun test/bun-compat.ts`).

## Getting started

```bash
git clone https://github.com/productdevbook/silgi.git
cd silgi
pnpm install
```

The first install also hydrates the `docs/`, `playground/`,
`dashboard/`, and `examples/*` workspaces.

## Everyday commands

All commands are defined in the root `package.json` and run from the
repo root.

| Command                | Purpose                                                           |
| ---------------------- | ----------------------------------------------------------------- |
| `pnpm dev`             | Run vitest in watch mode.                                         |
| `pnpm test`            | Run the full vitest suite once (CI mode).                         |
| `pnpm typecheck`       | Type-check the codebase with `tsgo --noEmit`.                     |
| `pnpm lint`            | Run `oxlint` and `oxfmt --check`.                                 |
| `pnpm lint:fix`        | Apply `oxlint --fix` and rewrite files with `oxfmt`.              |
| `pnpm format`          | Format the tree with `oxfmt`.                                     |
| `pnpm build`           | Build the dashboard and then bundle the package with `tsdown`.    |
| `pnpm docs:check`      | Validate public-API JSDoc with TypeDoc (warnings allowed).        |
| `pnpm bench:http`      | HTTP throughput benchmark.                                        |
| `pnpm bench:memory`    | Memory regression benchmark (validates CTX_POOL reuse).           |
| `pnpm play`            | Build the package, then launch the playground dev server.         |

## Project layout

```
src/              Library source (see ARCHITECTURE.md).
test/             Vitest specs — one file per concern, no snapshots.
bench/            Throughput, memory and type-level benchmarks.
examples/        End-to-end example apps (Express, Next.js, SvelteKit…).
playground/      Scratchpad for manual smoke tests.
docs/            User-facing documentation site (silgi.dev source).
docs/rfcs/       Internal design notes (see 0001-de-magic.md).
dashboard/       Analytics dashboard UI (Vue, built into the package).
lib/             Hand-maintained wrappers around third-party libs.
dist/            Generated build output — never edit by hand.
```

## Commit conventions

We follow **Conventional Commits** with a `scope` that maps to a top-level
`src/` area. A few real examples from the log:

```
fix(adapters): propagate event via AsyncLocalStorage, not WeakMap
refactor(core): decouple Zod from core via schema-converter registry
refactor(silgi)!: add silgi.ready() + opt-in signal handling in serve()
test: align stale tests with analytics auth + redaction changes
chore: apply oxfmt formatting
```

Rules of thumb:

- Use `fix`, `feat`, `refactor`, `perf`, `test`, `docs`, `chore`.
- A trailing `!` marks a breaking change. Add a `BREAKING CHANGE:` footer
  describing the migration.
- Keep the summary imperative and under ~72 chars.
- Group unrelated changes into separate commits — `git add -p` is your
  friend.

## Pull request checklist

Before requesting review:

- [ ] `pnpm typecheck` passes (no new `any` fallouts).
- [ ] `pnpm test` passes — add a new spec under `test/` for any
      behaviour change, even small ones.
- [ ] `pnpm lint` passes (`oxlint` + `oxfmt --check`). Run
      `pnpm lint:fix` if formatting complains.
- [ ] `pnpm docs:check` runs without errors for changes to public API.
      Warnings are tolerated for now.
- [ ] Public API changes are reflected in JSDoc on the exported symbol
      (`@param`, `@returns`, `@example` where it clarifies usage).
- [ ] Breaking changes are called out in the PR description and the
      commit uses the `!` marker.
- [ ] Benchmarks haven't regressed >5% (`pnpm bench:memory`,
      `pnpm bench:http`) when touching compiler / pipeline hot paths.

## Where to start

- Read [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the tour of the request
  pipeline and the performance invariants we defend.
- Read [`docs/rfcs/0001-de-magic.md`](./docs/rfcs/0001-de-magic.md) for
  the motivation behind the recent round of refactors.
- Skim [`SECURITY.md`](./SECURITY.md) before touching input parsing or
  the error pipeline.

## Reporting issues

Bug reports, reproduction cases, and design questions belong in
[GitHub Issues](https://github.com/productdevbook/silgi/issues).
Security-sensitive reports go through the private channel in
[`SECURITY.md`](./SECURITY.md).
