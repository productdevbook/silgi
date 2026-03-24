# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Silgi

Silgi is an end-to-end type-safe RPC framework for TypeScript — a single-package alternative to tRPC and oRPC. It ships compiled pipelines, supports every major runtime/framework, and is heavily optimized for V8 performance.

## Commands

```bash
pnpm build          # Build all entry points (obuild)
pnpm test           # Run all tests (vitest run)
pnpm dev            # Watch mode tests (vitest)
pnpm typecheck      # Type-check with tsgo (--noEmit)
pnpm lint           # oxlint + oxfmt --check
pnpm fix            # Auto-fix lint + format
pnpm format         # Run oxfmt only

# Run a single test file
pnpm vitest run test/core/api.test.ts

# Benchmarks
pnpm bench          # Run benchmarks (mitata)
pnpm bench:memory   # Memory profiling (--expose-gc)
```

## Architecture

### Core Flow

`silgi()` factory → procedures (`query`/`mutation`/`subscription`) → `router()` → `handler()`/`serve()` → adapter

### Key Modules (src/)

- **silgi.ts** — Factory function. Creates typed instance with `query()`, `mutation()`, `guard()`, `wrap()`, `router()`, `handler()`, `serve()`
- **compile.ts** — Pipeline compiler. Unrolls 0-4 guards into specialized code paths (no loop), uses ContextPool for zero per-request allocation, compiles router via rou3 (unjs radix tree)
- **types.ts** — `ProcedureDef` (fixed 8-property shape for V8 hidden class alignment), `RouterDef`, type inference helpers (`InferContextFromUse`, `InferSchemaInput`, `InferSchemaOutput`, `InferClient`)
- **core/error.ts** — `SilgiError` with cross-realm instanceof via global WeakSet registry. Error codes are UPPER_SNAKE_CASE
- **core/schema.ts** — Standard Schema v1 bridge (Zod, Valibot, ArkType). Generic `validateSchema()` function
- **core/sse.ts** — Server-Sent Events / streaming support
- **client/client.ts** — `createClient()` proxy-based RPC client with cached sub-proxy Map and `safe()` wrapper for `[error, data]` tuples

### Adapters (src/adapters/)

13 framework adapters (h3, express, elysia, nextjs, nitro, sveltekit, remix, astro, solidstart, nestjs, aws-lambda, message-port, peer). Each converts framework-specific request/response to `StandardRequest`/`StandardResponse`.

### Plugins (src/plugins/)

Composable middleware: cors, cookies, ratelimit, pino, otel, body-limit, batch-server, pubsub, compression, signing, coerce, file-upload, etc.

### Integrations (src/integrations/)

- **zod/** — Zod schema validation helpers
- **tanstack-query/** — React Query `queryOptions` generation
- **react/** — React Server Actions
- **ai/** — AI SDK `routerToTools`

### Codecs (src/codec/)

Content negotiation via `Accept` header: JSON (default), MessagePack, Devalue.

## Project Layout

- **All source** in `src/`, **all tests** in `test/` (single directories, not split by package)
- Tests use `#src` alias to import from source: `import { ... } from '#src/...'`
- ESM-only (`"type": "module"`)
- Node >= 24, pnpm >= 10

## Code Style

- **Chain formatting**: ALWAYS break builder chains into separate lines. Never write long single-line chains.
  ```ts
  // BAD — never do this
  const listUsers = s.$use(cacheQuery({ maxAge: 60 })).$resolve(({ ctx }) => ctx.db.users.findMany())

  // GOOD — always break
  const listUsers = s
    .$use(cacheQuery({ maxAge: 60 }))
    .$resolve(({ ctx }) => ctx.db.users.findMany())
  ```
- **Formatter**: oxfmt — single quotes, no semicolons, 120 char width, trailing commas
- **Linter**: oxlint — plugins: unicorn, typescript, oxc, import. `no-explicit-any` and `no-non-null-assertion` are allowed
- **Import sorting**: oxfmt auto-sorts imports by group (builtin → external → internal → parent → sibling → index → type) with newlines between groups. Internal patterns: `#src/`, `~/`
- **Import style**: `import/consistent-type-specifier-style` is enforced — use `import type` for type-only imports
- **Node imports**: `unicorn/prefer-node-protocol` is enforced — always use `node:` prefix (e.g. `node:path`)
- **ESM only**: Never use `require()` or `createRequire()`. Use `import.meta.resolve()` for module resolution

## Performance Patterns

These patterns are intentional and critical — do not refactor them away:

- **Fixed procedure shape**: All `ProcedureDef` objects have the same property order/count for V8 monomorphic inline caches
- **Unrolled guard pipeline**: `compile.ts` generates specialized 0/1/2/3/4-guard paths without loops
- **ContextPool**: Pre-allocated context objects, zero per-request allocation
- **Frozen arrays**: Child paths frozen via `Object.freeze` for V8 optimization
- **Direct property set**: Guards merge context via direct property assignment, not `Object.assign`
- **Unified handler**: Single `async handleRequest` code path — no duplicated fast paths. Clean, maintainable, correct.

## Workflow Rules

- **Every feature/fix MUST include docs**: When adding or changing any user-facing feature, update the relevant docs page in `docs/content/docs/` in the SAME commit or immediately after. Never skip docs.
- **Every feature MUST include tests**: Type-level tests (`expectTypeOf`) in `test/core/types.test.ts`, runtime tests in the appropriate `test/` file.

## Documentation (docs/)

Docs site lives in `docs/` — powered by [Fumadocs](https://fumadocs.vercel.app). Pages are `.mdx` files under `docs/content/docs/`.

### Writing docs

- **Framework**: Fumadocs with React components
- **File format**: MDX with YAML frontmatter (`title`, `description`)
- **Available components**: Import from `fumadocs-ui/components/*`:
  - `<Tabs items={['npm', 'pnpm', 'bun']}>` + `<Tab value='npm'>` — tabbed content
  - `<Callout type='info|warn'>` — info/warning boxes
  - `<Steps>` + `<Step>` — numbered steps
  - `<Files>` + `<Folder>` + `<File>` — file tree diagrams

### Install commands — ALWAYS use Tabs

When showing package install commands, always provide all three package managers in tabs:

```mdx
<Tabs items={['pnpm', 'npm', 'bun']}>
  <Tab value='pnpm'>
  ```bash
  pnpm add silgi
  ```
  </Tab>
  <Tab value='npm'>
  ```bash
  npm install silgi
  ```
  </Tab>
  <Tab value='bun'>
  ```bash
  bun add silgi
  ```
  </Tab>
</Tabs>
```

### Code blocks

- Use ` ```ts twoslash ` for TypeScript with type hints
- Add `// @noErrors` at the top of twoslash blocks that reference external symbols
- Add `title="src/server.ts"` to show a filename header
- Keep examples minimal and runnable

### Style rules

- Start each page with a plain-language intro paragraph before any heading
- Use short sentences. Avoid jargon when a simpler word works
- Tables for options/config — columns: name, type/value, description
- `<Callout>` for gotchas, prerequisites, and tips — not for normal content
- Don't repeat information that's on another page — link to it instead

## Changelog (docs/content/changelog/)

Each release gets its own MDX file at `docs/content/changelog/{version}.mdx` (e.g. `0-1-0-beta-3.mdx`).

### Frontmatter

```yaml
---
title: 0.1.0-beta.3
description: One-line summary of the release.
version: 0.1.0-beta.3
date: 2026-03-22
---
```

### Writing rules

- **Read the actual source code** before writing examples — never guess API signatures. Check `src/` for the real function names, parameters, and return types.
- **Show real working code** — import paths must match `package.json` exports (e.g. `silgi/drizzle`, `silgi/better-auth`). Copy from `@example` JSDoc in the source if available.
- **Link to docs pages** — every feature mention should link to its docs page (e.g. `[Drizzle integration docs](/docs/libraries/drizzle)`)
- **List concrete features** — don't just say "new integration", list what it actually does (auto-tracing, specific functions exported, what shows in the dashboard)
- **Include dashboard impact** — if a feature affects the analytics dashboard, describe what the user will see (e.g. "Dashboard shows: `auth.signin.email (4.2ms)`")
- **Group by impact** — major features first with code examples, then smaller changes as bullet lists
- **Don't repeat docs content** — changelog shows what changed and why, docs explain how to use it. Link, don't duplicate.
- **Security fixes get their own section** with clear before/after description
