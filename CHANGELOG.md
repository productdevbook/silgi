# Changelog

## 0.1.0 (2026-03-18)

### Features

- **katman()** — Main API entry point with typed context, guard/wrap middleware
- **serve()** — One-line Node.js HTTP server with auto port finding, HTTP/2, WebSocket
- **handler()** — Fetch API handler for Node, Bun, Deno, Cloudflare Workers
- **Compiled pipeline** — Pre-linked middleware chain, unrolled guard runners (5.7x faster than oRPC)
- **Type inference** — Input, output, context, errors fully typed with InferClient
- **Standard Schema** — Works with Zod, Valibot, ArkType via @standard-schema/spec

### Protocols

- **JSON** — Default, fastest encode/decode
- **MessagePack** — Binary protocol, 30% smaller payloads (`katman/msgpack`)
- **devalue** — Rich types: Date, Map, Set, BigInt, RegExp (`katman/devalue`)
- **WebSocket RPC** — Bidirectional via crossws (`katman/ws`)
- **SSE** — Server-Sent Events for subscriptions
- **HTTP/2** — TLS with HTTP/1.1 fallback

### Client

- **createClient** — Type-safe proxy client with cached sub-proxies
- **ofetch transport** — Retry, timeout, interceptors, binary mode (`katman/client/ofetch`)
- **Fetch transport** — Lightweight alternative (`katman/client/fetch`)
- **Plugins** — Retry, dedupe, batch, CSRF (`katman/client/plugins`)

### Server Plugins

- **CORS** — Header generation (`katman/cors`)
- **OpenTelemetry** — Span-per-call wrap middleware (`katman/otel`)
- **Pino** — Structured logging hooks (`katman/pino`)
- **Rate Limiting** — Guard middleware with sliding window (`katman/ratelimit`)

### Integrations

- **React Server Actions** — createAction/createActions/createFormAction (`katman/react`)
- **TanStack Query** — queryOptions/mutationOptions/queryKey (`katman/tanstack-query`)
- **Zod** — Schema to JSON Schema converter (`katman/zod`)
- **Scalar** — OpenAPI 3.1.0 spec + API Reference UI at /reference

### Developer Experience

- **Lifecycle hooks** — request, response, error, serve:start (hookable)
- **Sucrose analysis** — Static handler optimization via Function.toString()
- **Response cache** — ohash-keyed TTL cache with prefix invalidation
- **Bun compatible** — 2us/req handler performance
- **Single package** — No monorepo, one `npm install katman`

### Build

- obuild (rolldown + oxc), 124KB dist, 587ms build
- tsgo type checking
- 203 tests across 18 test files
