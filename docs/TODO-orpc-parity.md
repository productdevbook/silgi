# oRPC Feature Parity — Katman TODO

oRPC ile karsilastirildiginda Katman'da eksik olan ozellikler.

> Zaten mevcut: Contract-First (src/contract.ts), Client Batch (client/plugins/batch.ts),
> Client Dedupe (client/plugins/dedupe.ts), Client CSRF (client/plugins/csrf.ts),
> Client Retry (client/plugins/retry.ts)

## Kritik Eksikler

- [ ] **File Upload/Download** — Native File/Blob type-safe destegi (input schema'da `z.file()`)
- [ ] **Server-side Batch Requests** — Server tarafinda batch endpoint (client plugin mevcut)
- [x] **Server-side Client** — `createServerClient(router, { context })` — HTTP'siz direkt cagrisi
- [x] **Callable Procedures** — `callable(procedure, { context })` ile proseduru fonksiyon gibi cagirma
- [x] **Meta in ProcedureDef** — meta alani ProcedureDef'e eklendi (8. property)

## Framework Adaptorleri

- [ ] Next.js (App Router + Pages Router)
- [ ] Nuxt
- [ ] Remix
- [ ] Astro
- [ ] Hono
- [ ] Express
- [ ] Elysia
- [ ] H3
- [ ] SvelteKit
- [ ] SolidStart
- [ ] NestJS
- [ ] AWS Lambda
- [ ] Message Port (Electron, browser extensions, Web Workers)
- [ ] Peer-to-peer (Standard Server Peer)

## Plugin / Guvenlik

- [x] **Response Compression** — `compressionWrap()` — gzip/deflate hint middleware
- [x] **Body Limit** — `bodyLimitGuard()` — 413 Payload Too Large guard
- [x] **Cookie Helpers** — `getCookie`, `parseCookies`, `setCookie`, `deleteCookie` (katman/cookies)
- [ ] **Signing & Encryption** — HMAC-SHA256 imza, AES-GCM sifreleme
- [ ] **Publisher/PubSub** — Event pub/sub (Memory, Redis, Durable Objects adapterleri)
- [x] **Strict GET Method** — `strictGetGuard` — 405 on non-GET for queries

## Client Gelistirmeleri

- [x] **DynamicLink** — Runtime'da link secimi (cache, auth, feature flags bazli)
- [x] **Client Merging** — `mergeClients()` ile birden fazla client'i birlestirme
- [x] **Client Interceptors** — `withInterceptors()` ile link-level hooks

## TanStack Query Gelistirmeleri

- [ ] `.streamedOptions()` — Streaming query destegi (data array'e eklenir)
- [ ] `.liveOptions()` — Live query (son event oncekini degistirir)
- [x] `.infiniteOptions()` — Infinite/paginated query
- [x] `skipToken` — Type-safe query devre disi birakma
- [ ] SSR hydration — Custom serializer'lar ile refetch waterfall onleme

## React Gelistirmeleri

- [ ] `useServerAction` hook — Loading state ile server action cagrisi
- [ ] `useOptimisticServerAction` hook — Optimistic UI update

## Middleware Gelistirmeleri

- [ ] **Input Mapping** — `.mapInput()` ile middleware'de input shape donusturme
- [ ] **Middleware Lifecycle Hooks** — `onStart`, `onSuccess`, `onError`, `onFinish`

## Diger

- [ ] **tRPC Interop** — tRPC router'larini Katman'a donusturme (migration path)
- [ ] **Custom JSON Serializers** — Ozel tip serializasyonu genisletme
- [ ] **OpenAPI Client** — OpenAPI endpoint'lerini client olarak consume etme
- [ ] **Durable Iterator** — Cloudflare Durable Object streaming + reconnection
- [ ] **Hibernation Plugin** — CF Durable Object WebSocket hibernation
- [ ] **Smart Coercion** — String query param'lari otomatik tipe cevirme

---

**Katman'in mevcut avantajlari (korumaya devam):**
- Single package (35+ paket yerine 1)
- Compiled pipeline optimizasyonu (startup'ta pre-link)
- Guard/Wrap middleware modeli (flat + onion)
- Context pooling (zero-allocation)
- Monomorphic V8 inline cache optimizasyonu
