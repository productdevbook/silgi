# TechEmpower Strategy — Katman

## Mevcut Durum

### TechEmpower JS/TS Sıralaması (Round 22, plaintext)
| # | Framework | Nasıl | ~req/s |
|---|---|---|---|
| 1 | uWebSockets.js | C++ HTTP, JS bindings | ~3M |
| 2 | HyperExpress | uWS wrapper | ~2.8M |
| 3 | Bun.serve | Zig HTTP server | ~1.5M |
| 4 | Elysia (Bun) | Bun.serve wrapper | ~1.2M |
| 5 | Fastify | Node.js http | ~500K |
| 6 | H3/Nitro | Node.js srvx | ~300K |

### Genel Top 5 (C++/Rust)
| # | Framework | Dil | ~req/s |
|---|---|---|---|
| 1 | drogon | C++ | ~7M |
| 2 | may-minihttp | Rust | ~7M |
| 3 | ntex | Rust | ~7M |
| 4 | actix | Rust | ~6.8M |
| 5 | h2o | C | ~6.5M |

---

## Araştırma Bulguları

### 1. Greenfield Alan
GitHub'da "napi-rs + HTTP server" araması: **0 ciddi proje**. Tek örnek SylphxAI/gust (1 star) — hyper + tokio + napi-rs ile çalışıyor. Alan tamamen boş.

### 2. Gust Projesi — Tek Referans
- hyper + tokio Rust HTTP server
- `ThreadsafeFunction<RequestContext>` ile JS handler çağrısı
- `ArcSwap` ile lock-free hot-path
- `mimalloc` global allocator
- **Sonuçlar (Bun, M3 Max):**
  - Static routes (zero JS): 232K req/s
  - Dynamic routes (JS callback): 141K req/s
  - → JS callback overhead: **~40%**

### 3. ThreadsafeFunction Darboğazı
JS handler çağrısı queue-based message passing kullanıyor. Her request için:
1. Rust thread → napi queue'ya mesaj at
2. V8 event loop → mesajı al
3. JS handler çalış
4. Sonucu Rust'a geri gönder

Bu 4-step overhead ~40% throughput kaybı demek. uWebSockets.js bunu `DeclarativeResponse` ile bypass ediyor — plaintext/json için JS hiç çalışmıyor.

### 4. Major Projelerin Rust→JS Patternleri

**Rolldown, Turbopack, Rspack** hepsi aynı pattern:
```rust
#[napi::module_init]
fn init() {
    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(num_cpus::get_physical())
        .enable_all()
        .build();
    create_custom_tokio_runtime(rt);
}
```
- Custom tokio runtime at module init
- mimalloc/turbo_malloc global allocator
- ThreadsafeFunction for async callbacks

### 5. uWebSockets.js Neden Hızlı
- C++ HTTP parser (epoll/kqueue direkt, libuv yok)
- `DeclarativeResponse` — plaintext response pre-compiled buffer, zero JS
- `response.cork()` — tüm write'ları tek syscall'a batch
- HTTP pipelining native support (16 request/connection)
- cluster ile multi-core

### 6. TechEmpower Submission Gereksinimleri

```
frameworks/JavaScript/katman/
├── benchmark_config.json    # test tanımları
├── katman.dockerfile        # plaintext + json
├── katman-postgres.dockerfile # db testleri
├── package.json
└── src/
    ├── server.js            # ana server
    ├── clustered.js         # cluster wrapper
    └── database/
        └── postgres.js      # DB katmanı
```

**Test endpoint'leri:**
| Test | URL | Açıklama |
|---|---|---|
| plaintext | `/plaintext` | "Hello, World!" text/plain, HTTP pipelining |
| json | `/json` | `{"message":"Hello, World!"}` |
| db | `/db` | Tek random World row |
| queries | `/queries?queries=N` | N adet random World row (1-500) |
| fortune | `/fortunes` | 13 row + HTML template + XSS escape |
| update | `/updates?queries=N` | Fetch + update N row |
| cached | `/cached-worlds?count=N` | LRU cache'den serve |

**Kritik optimizasyonlar (top JS submissions):**
- `node:cluster` ile `availableParallelism()` worker
- `slow-json-stringify` / `fast-json-stringify` (schema-based)
- `postgres` (porsager) raw SQL, `max: 1` connection/worker
- Bulk UPDATE with VALUES clause
- Manual insertion sort (13 element Fortune)
- Custom HTML escape (no template engine)
- Pre-allocated arrays, bitwise OR for parseInt

---

## Strateji: 3 Seviye

### Seviye 1: Node.js kategorisinde #1 (Fastify'ı geç)
**Hedef: 600K+ req/s | Süre: 1 hafta**

Mevcut `k.serve()` + TechEmpower optimizasyonları:
- [ ] `node:cluster` multi-core support
- [ ] `fast-json-stringify` schema-based serialization
- [ ] Pre-computed plaintext buffer
- [ ] `Server` + `Date` header (Date 1/saniye güncelle)
- [ ] TechEmpower submission dosyaları
- [ ] PostgreSQL katmanı (`postgres` kütüphanesi)

### Seviye 2: JS kategorisinde #1 (uWS'e yaklaş)
**Hedef: 2M+ req/s | Süre: 2-3 hafta**

İki yol var:

**Yol A: @katman/http — Rust native addon (napi-rs)**
```
Rust (napi-rs)                    TypeScript
┌──────────────────────┐         ┌──────────────────────┐
│ tokio TCP accept     │         │                      │
│ httparse HTTP parse  │  ──→    │ handler({ input })   │
│ matchit router       │  ←──    │ return { data }      │
│ hyper HTTP write     │         │                      │
└──────────────────────┘         └──────────────────────┘
```

Avantajlar:
- Tam kontrol, özel paket (takumi-rs gibi)
- WASM fallback ile Cloudflare/Deno destegi
- `@katman/http` olarak npm'de yayınla

Dezavantajlar:
- Cross-platform build (darwin-arm64, linux-x64, win32-x64)
- ThreadsafeFunction overhead (~40% — gust'ın ölçümü)
- Maintenance yükü

**Yol B: uWebSockets.js adapter**
```ts
import { katmanUWS } from "katman/uws"
// uWS HTTP layer + Katman compiled pipeline
```

Avantajlar:
- Kanıtlanmış performans (TechEmpower'da zaten #1 JS)
- Küçük adapter kodu
- uWS maintenance başkasında

Dezavantajlar:
- uWS API'sine bağımlılık
- `DeclarativeResponse` Katman'ın dinamik pipeline'ı ile uyumsuz
- uWS'in lisans/bakım riski (Alex Hultman tek maintainer)

**Yol C: Bun.serve adapter**
```ts
// Bun runtime + Katman handler
Bun.serve({ port: 8080, reusePort: true, fetch: handler(appRouter) })
```

Avantajlar:
- Çok basit, handler() zaten Fetch API uyumlu
- Bun'ın Zig HTTP server'ı hızlı (~1.5M)
- `reusePort` ile kernel-level load balancing

Dezavantajlar:
- Sadece Bun runtime (Node.js değil)
- Bun'ın TechEmpower'daki sırası uWS'in gerisinde

### Seviye 3: Genel top 20
**Hedef: 5M+ req/s | Pratik olarak imkansız pure JS ile**

Bunun için Rust'ta tam HTTP+RPC handler + JS sadece config:
- Bu artık Katman değil, yeni bir proje olur
- Rust'ta procedure compilation, guard execution, JSON serialization
- JS sadece prosedür tanımı, Rust hepsini çalıştırır

---

## Önerilen Yol Haritası

### Faz 1: TechEmpower Submission (1 hafta)
Mevcut `k.serve()` ile submission hazırla. cluster ekle.
**Hedef: Node.js framework'leri arasında Fastify'ı geçmek.**

### Faz 2: @katman/http Rust Addon (2-3 hafta)
napi-rs + hyper + tokio ile HTTP server yaz.
- Gust'ın patternini takip et (ThreadsafeFunction + ArcSwap)
- Static routes Rust'ta handle et (plaintext/json — zero JS)
- Dynamic routes JS callback ile
- mimalloc allocator
- WASM fallback

**Hedef: uWebSockets.js'e yaklaşmak veya geçmek.**

### Faz 3: Optimize & Submit (1 hafta)
TechEmpower Round 23 için final optimizasyonlar.
- simd-json Rust'ta, sonuçları buffer olarak JS'e geç
- HTTP pipelining native support
- DB connection pooling Rust'ta

---

## Kritik Karar: Yol A vs B vs C

| Kriter | A: Rust (@katman/http) | B: uWebSockets.js | C: Bun.serve |
|---|---|---|---|
| Max throughput | ~2-4M | ~3M (kanıtlanmış) | ~1.5M |
| Geliştirme süresi | 2-3 hafta | 2-3 gün | 1 gün |
| Cross-platform | Zor (CI/CD) | Kolay (npm) | Sadece Bun |
| Kontrol | Tam | Sınırlı | Sınırlı |
| Long-term | En iyi | Alex'e bağımlı | Bun'a bağımlı |
| TechEmpower | Top 20 potansiyeli | JS #1 | JS top 5 |

**Öneri: Faz 1'de C (Bun.serve — hemen) + Faz 2'de A (Rust — uzun vadede).**

Bun adapter 1 günde hazır, hemen TechEmpower'a submit edilir.
Rust addon paralelde geliştirilir, hazır olunca swap edilir.
