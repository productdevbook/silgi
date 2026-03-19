# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Katman

Katman is an end-to-end type-safe RPC framework for TypeScript — a single-package alternative to tRPC and oRPC. It ships compiled pipelines, supports every major runtime/framework, and is heavily optimized for V8 performance.

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

`katman()` factory → procedures (`query`/`mutation`/`subscription`) → `router()` → `handler()`/`serve()` → adapter

### Key Modules (src/)

- **katman.ts** — Factory function. Creates typed instance with `query()`, `mutation()`, `guard()`, `wrap()`, `router()`, `handler()`, `serve()`
- **compile.ts** — Pipeline compiler. Unrolls 0-4 guards into specialized code paths (no loop), uses ContextPool for zero per-request allocation, compiles router into flat Map for O(1) lookup
- **types.ts** — `ProcedureDef` (fixed 7-property shape for V8 hidden class alignment), `RouterDef`, type inference helpers (`InferContextFromUse`, `InferSchemaInput`, `InferSchemaOutput`, `InferClient`)
- **core/error.ts** — `KatmanError` with cross-realm instanceof via global WeakSet registry. Error codes are UPPER_SNAKE_CASE
- **core/schema.ts** — Standard Schema v1 bridge (Zod, Valibot, ArkType). Generic `validateSchema()` function
- **core/sse.ts** — Server-Sent Events / streaming support
- **client/client.ts** — `createClient()` proxy-based RPC client with cached sub-proxy Map and `safe()` wrapper for `[error, data]` tuples

### Adapters (src/adapters/)

15 framework adapters (fastify, h3, hono, express, elysia, nextjs, nitro, sveltekit, remix, astro, solidstart, nestjs, aws-lambda, message-port, peer). Each converts framework-specific request/response to `StandardRequest`/`StandardResponse`.

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
- **Sucrose-style analysis** (`analyze.ts`): `Function.toString()` introspection for compile-time optimization decisions

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
  pnpm add katman
  ```
  </Tab>
  <Tab value='npm'>
  ```bash
  npm install katman
  ```
  </Tab>
  <Tab value='bun'>
  ```bash
  bun add katman
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
