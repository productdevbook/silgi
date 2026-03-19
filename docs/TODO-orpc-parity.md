# oRPC Feature Parity — Katman TODO

oRPC ile karsilastirildiginda tamamlanan ve kalan ozellikler.

> Zaten mevcut: Contract-First (src/contract.ts), Client Batch (client/plugins/batch.ts),
> Client Dedupe (client/plugins/dedupe.ts), Client CSRF (client/plugins/csrf.ts),
> Client Retry (client/plugins/retry.ts)

## Kritik Eksikler — TAMAMLANDI

- [x] **File Upload/Download** — `fileGuard()` + `parseMultipart()` — size/MIME validation
- [x] **Server-side Batch Requests** — `createBatchHandler()` — batch endpoint
- [x] **Server-side Client** — `createServerClient(router, { context })` — HTTP'siz direkt cagrisi
- [x] **Callable Procedures** — `callable(procedure, { context })` ile proseduru fonksiyon gibi cagirma
- [x] **Meta in ProcedureDef** — meta alani ProcedureDef'e eklendi (8. property)

## Framework Adaptorleri

- [x] Next.js (App Router) — `katmanNextjs()`
- [x] Nuxt — Nitro adapter ile (`katmanNitro()`)
- [x] Remix — `katmanRemix()`
- [x] Astro — `katmanAstro()`
- [x] Hono — `katmanHono()`
- [x] Express — `katmanExpress()`
- [x] Elysia — `katmanElysia()`
- [x] H3 (v2) — `katmanH3()`
- [x] SvelteKit — `katmanSvelteKit()`
- [x] SolidStart — `katmanSolidStart()`
- [x] AWS Lambda — `katmanLambda()`
- [x] Message Port — `katmanMessagePort()` + `MessagePortLink`
- [x] NestJS — `katmanNestHandler()`
- [x] Peer-to-peer — `createPeer()` (bidirectional RPC over MessagePort)

## Plugin / Guvenlik — TAMAMLANDI

- [x] **Response Compression** — `compressionWrap()`
- [x] **Body Limit** — `bodyLimitGuard()`
- [x] **Cookie Helpers** — `getCookie`, `parseCookies`, `setCookie`, `deleteCookie`
- [x] **Signing & Encryption** — `sign`, `unsign`, `encrypt`, `decrypt`
- [x] **Publisher/PubSub** — `createPublisher()` + `MemoryPubSub`
- [x] **Strict GET Method** — `strictGetGuard`
- [x] **File Upload** — `fileGuard()` + `parseMultipart()`

## Client — TAMAMLANDI

- [x] **DynamicLink** — Runtime'da link secimi
- [x] **Client Merging** — `mergeClients()`
- [x] **Client Interceptors** — `withInterceptors()`
- [x] **OpenAPI Client** — `OpenAPILink` — consume any OpenAPI endpoint

## TanStack Query — TAMAMLANDI

- [x] `.streamedOptions()` — Streaming query
- [x] `.liveOptions()` — Live query (polling)
- [x] `.infiniteOptions()` — Infinite/paginated query
- [x] `skipToken` — Type-safe query disabling
- [x] SSR hydration — `prefetchQueries()` + `dehydrate()` + `createSSRSerializer()`

## React — TAMAMLANDI

- [x] `useServerAction` hook
- [x] `useOptimisticServerAction` hook

## Middleware — TAMAMLANDI

- [x] **Input Mapping** — `mapInput()`
- [x] **Middleware Lifecycle Hooks** — `lifecycleWrap()`

## Diger

- [x] **tRPC Interop** — `fromTRPC()`
- [x] **Custom JSON Serializers** — `createSerializer()`
- [x] **OpenAPI Client** — `OpenAPILink`
- [x] **Smart Coercion** — `coerceGuard`
- [ ] **Durable Iterator** — CF Durable Object streaming (CF-specific, low priority)
- [ ] **Hibernation Plugin** — CF Durable Object WebSocket hibernation (CF-specific, low priority)

---

**Tamamlanan: 46 ozellik**
**Kalan: 2 (CF Durable Iterator, CF Hibernation — Cloudflare-specific)**

**Katman'in avantajlari:**
- Single package (35+ paket yerine 1)
- Compiled pipeline (startup'ta pre-link)
- Guard/Wrap middleware modeli
- Context pooling (zero-allocation)
- Monomorphic V8 inline cache
- 2.1-2.3x Nitro'dan hizli (benchmark kanitli)
