# oRPC Feature Parity — Katman TODO

oRPC ile karsilastirildiginda Katman'da eksik olan ozellikler.

> Zaten mevcut: Contract-First (src/contract.ts), Client Batch (client/plugins/batch.ts),
> Client Dedupe (client/plugins/dedupe.ts), Client CSRF (client/plugins/csrf.ts),
> Client Retry (client/plugins/retry.ts)

## Kritik Eksikler

- [x] **File Upload/Download** — `fileGuard()` + `parseMultipart()` — size/MIME validation
- [x] **Server-side Batch Requests** — `createBatchHandler()` — batch endpoint
- [x] **Server-side Client** — `createServerClient(router, { context })` — HTTP'siz direkt cagrisi
- [x] **Callable Procedures** — `callable(procedure, { context })` ile proseduru fonksiyon gibi cagirma
- [x] **Meta in ProcedureDef** — meta alani ProcedureDef'e eklendi (8. property)

## Framework Adaptorleri

- [x] Next.js (App Router) — `katmanNextjs()`
- [ ] Nuxt (Nitro adapter ile destekleniyor)
- [ ] Remix
- [ ] Astro
- [x] Hono — `katmanHono()`
- [x] Express — `katmanExpress()`
- [x] Elysia — `katmanElysia()`
- [x] H3 (v2) — `katmanH3()`
- [x] SvelteKit — `katmanSvelteKit()`
- [ ] SolidStart
- [ ] NestJS
- [x] AWS Lambda — `katmanLambda()`
- [ ] Message Port (Electron, browser extensions, Web Workers)
- [ ] Peer-to-peer (Standard Server Peer)

## Plugin / Guvenlik

- [x] **Response Compression** — `compressionWrap()` — gzip/deflate hint middleware
- [x] **Body Limit** — `bodyLimitGuard()` — 413 Payload Too Large guard
- [x] **Cookie Helpers** — `getCookie`, `parseCookies`, `setCookie`, `deleteCookie` (katman/cookies)
- [x] **Signing & Encryption** — `sign`, `unsign`, `encrypt`, `decrypt` (Web Crypto API)
- [x] **Publisher/PubSub** — `createPublisher()` + `MemoryPubSub` (Redis pluggable)
- [x] **Strict GET Method** — `strictGetGuard` — 405 on non-GET for queries
- [x] **File Upload** — `fileGuard()` + `parseMultipart()` — multipart form data

## Client Gelistirmeleri

- [x] **DynamicLink** — Runtime'da link secimi (cache, auth, feature flags bazli)
- [x] **Client Merging** — `mergeClients()` ile birden fazla client'i birlestirme
- [x] **Client Interceptors** — `withInterceptors()` ile link-level hooks

## TanStack Query Gelistirmeleri

- [x] `.streamedOptions()` — Streaming query destegi (data array'e eklenir)
- [x] `.liveOptions()` — Live query (refetchInterval ile polling)
- [x] `.infiniteOptions()` — Infinite/paginated query
- [x] `skipToken` — Type-safe query devre disi birakma
- [x] SSR hydration — `prefetchQueries()` + `dehydrate()` + `createSSRSerializer()`

## React Gelistirmeleri

- [x] `useServerAction` hook — Loading/error state ile server action cagrisi
- [x] `useOptimisticServerAction` hook — Optimistic UI update + rollback

## Middleware Gelistirmeleri

- [x] **Input Mapping** — `mapInput()` ile middleware'de input shape donusturme
- [x] **Middleware Lifecycle Hooks** — `lifecycleWrap({ onStart, onSuccess, onError, onFinish })`

## Diger

- [x] **tRPC Interop** — `fromTRPC()` ile tRPC router'larini Katman'a donusturme
- [x] **Custom JSON Serializers** — `createSerializer()` ile ozel tip destegi
- [ ] **OpenAPI Client** — OpenAPI endpoint'lerini client olarak consume etme
- [ ] **Durable Iterator** — Cloudflare Durable Object streaming + reconnection
- [ ] **Hibernation Plugin** — CF Durable Object WebSocket hibernation
- [x] **Smart Coercion** — `coerceGuard` + `coerceValue`/`coerceObject` utilities

---

**Kalan: 7 ozellik** (OpenAPI Client, Durable Iterator, Hibernation, Nuxt, Remix, Astro, SolidStart, NestJS, Message Port, Peer-to-peer)

**Tamamlanan: 37 ozellik**

**Katman'in mevcut avantajlari (korumaya devam):**
- Single package (35+ paket yerine 1)
- Compiled pipeline optimizasyonu (startup'ta pre-link)
- Guard/Wrap middleware modeli (flat + onion)
- Context pooling (zero-allocation)
- Monomorphic V8 inline cache optimizasyonu
