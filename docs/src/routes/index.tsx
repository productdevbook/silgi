import { createFileRoute, Link } from '@tanstack/react-router';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '@/lib/layout.shared';
import { useState } from 'react';

export const Route = createFileRoute('/')({
  component: Home,
});

function Home() {
  return (
    <HomeLayout {...baseOptions()}>
      <div className="landing-body">
        <Hero />
        <LayersSection />
        <FeaturesGrid />
        <CodeSection />
        <ProtocolsSection />
        <CTASection />
      </div>
    </HomeLayout>
  );
}

/* ─── Hero ─────────────────────────────────────────── */

function Hero() {
  const [pm, setPm] = useState<'npm' | 'pnpm' | 'bun'>('pnpm');
  const cmds = { npm: 'npm install katman', pnpm: 'pnpm add katman', bun: 'bun add katman' };

  return (
    <section className="relative overflow-hidden noise-overlay">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/4 -top-32 h-[600px] w-[600px] rounded-full bg-amber-500/[0.07] blur-[140px] animate-glow" />
        <div className="absolute right-1/4 top-20 h-[400px] w-[400px] rounded-full bg-fd-primary/[0.05] blur-[120px]" />
      </div>

      <div className="relative mx-auto max-w-5xl px-6 pt-28 pb-24 text-center">
        {/* Badge */}
        <div className="animate-fade-up mb-8 inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/[0.06] px-4 py-1.5">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-400" />
          </span>
          <span className="landing-mono text-xs text-amber-300/80">v0.1.0</span>
        </div>

        {/* Title */}
        <h1 className="animate-fade-up-1 landing-hero-title mb-6 text-5xl font-extrabold tracking-tight md:text-7xl">
          Build APIs in
          <br />
          <span className="bg-gradient-to-r from-amber-300 via-orange-400 to-rose-400 bg-clip-text text-transparent">
            layers
          </span>
        </h1>

        {/* Subtitle */}
        <p className="animate-fade-up-2 mx-auto mb-10 max-w-lg text-lg leading-relaxed text-fd-muted-foreground">
          Katman is a type-safe RPC framework for TypeScript.
          Define guards, compose pipelines, serve everywhere.
        </p>

        {/* CTA */}
        <div className="animate-fade-up-3 mb-12 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/docs/$"
            params={{ _splat: 'getting-started' }}
            className="group relative overflow-hidden rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 px-7 py-3 text-sm font-semibold text-black shadow-lg shadow-amber-500/20 transition hover:shadow-amber-500/30"
          >
            Get Started
            <span className="absolute inset-0 bg-white/10 opacity-0 transition group-hover:opacity-100" />
          </Link>
          <a
            href="https://github.com/productdevbook/katman"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-fd-border px-7 py-3 text-sm font-medium transition hover:bg-fd-accent"
          >
            GitHub
          </a>
        </div>

        {/* Install */}
        <div className="animate-fade-up-4 mx-auto max-w-xs overflow-hidden rounded-xl border border-fd-border bg-fd-card/80 backdrop-blur-sm shadow-xl">
          <div className="flex border-b border-fd-border">
            {(Object.keys(cmds) as Array<keyof typeof cmds>).map((key) => (
              <button
                key={key}
                onClick={() => setPm(key)}
                className={`flex-1 py-2 text-xs font-medium transition ${
                  pm === key
                    ? 'text-amber-400 shadow-[inset_0_-2px_0] shadow-amber-400'
                    : 'text-fd-muted-foreground hover:text-fd-foreground'
                }`}
              >
                {key}
              </button>
            ))}
          </div>
          <div className="px-4 py-3 landing-mono text-sm">
            <span className="text-fd-muted-foreground/60">$ </span>
            <span className="text-fd-foreground">{cmds[pm]}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Layers Visualization ─────────────────────────── */

function LayersSection() {
  return (
    <section className="relative border-t border-fd-border grid-pattern">
      <div className="mx-auto max-w-5xl px-6 py-28">
        <div className="grid items-center gap-16 lg:grid-cols-2">
          {/* Visual — stacked layers */}
          <div className="relative flex items-center justify-center py-8">
            <div className="relative w-72">
              {/* Layer 3 — Server (bottom) */}
              <div className="animate-layer-3 relative z-10 rounded-2xl border border-fd-border bg-fd-card p-5 shadow-2xl shadow-black/20">
                <div className="mb-2 flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-emerald-400" />
                  <span className="landing-mono text-[11px] text-fd-muted-foreground uppercase tracking-widest">Server</span>
                </div>
                <div className="landing-mono text-xs text-fd-muted-foreground/60 space-y-1">
                  <p>serve() &middot; handler()</p>
                  <p>HTTP/2 &middot; WebSocket</p>
                </div>
              </div>

              {/* Layer 2 — Pipeline (middle) */}
              <div className="animate-layer-2 relative z-20 -mt-4 ml-6 rounded-2xl border border-amber-500/20 bg-fd-card p-5 shadow-2xl shadow-black/20">
                <div className="mb-2 flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-amber-400" />
                  <span className="landing-mono text-[11px] text-amber-400/80 uppercase tracking-widest">Pipeline</span>
                </div>
                <div className="landing-mono text-xs text-fd-muted-foreground/60 space-y-1">
                  <p>guard() &middot; wrap()</p>
                  <p>compiled &middot; unrolled</p>
                </div>
              </div>

              {/* Layer 1 — Client (top) */}
              <div className="animate-layer-1 relative z-30 -mt-4 ml-12 rounded-2xl border border-fd-border bg-fd-card p-5 shadow-2xl shadow-black/20">
                <div className="mb-2 flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-sky-400" />
                  <span className="landing-mono text-[11px] text-fd-muted-foreground uppercase tracking-widest">Client</span>
                </div>
                <div className="landing-mono text-xs text-fd-muted-foreground/60 space-y-1">
                  <p>createClient&lt;T&gt;()</p>
                  <p>typed &middot; inferred</p>
                </div>
              </div>
            </div>
          </div>

          {/* Text */}
          <div>
            <h2 className="landing-hero-title mb-4 text-3xl font-bold">
              Architecture in
              <span className="text-amber-400"> layers</span>
            </h2>
            <p className="mb-6 text-fd-muted-foreground leading-relaxed">
              Katman (Turkish for <em>layer</em>) organizes your API into clean, composable layers.
              Guards enrich context. Pipelines compile at startup. Types flow end-to-end.
            </p>
            <div className="space-y-3 text-sm">
              <LayerItem color="bg-sky-400" label="Client" desc="Full autocomplete — types inferred, not generated" />
              <LayerItem color="bg-amber-400" label="Pipeline" desc="Guards + wraps compiled into a pre-linked chain" />
              <LayerItem color="bg-emerald-400" label="Server" desc="HTTP, HTTP/2, WebSocket, Scalar — one line" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function LayerItem({ color, label, desc }: { color: string; label: string; desc: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${color}`} />
      <div>
        <span className="font-semibold">{label}</span>
        <span className="text-fd-muted-foreground"> — {desc}</span>
      </div>
    </div>
  );
}

/* ─── Features Grid ────────────────────────────────── */

function FeaturesGrid() {
  const features = [
    { icon: '⌘', title: 'End-to-end types', desc: 'Input, output, context, errors. No codegen. No runtime cost.' },
    { icon: '◆', title: 'Single package', desc: 'Server, client, plugins, codecs. One npm install.' },
    { icon: '◇', title: 'Standard Schema', desc: 'Zod, Valibot, ArkType. Bring your own validator.' },
    { icon: '⚡', title: 'Compiled pipeline', desc: 'Pre-linked at startup. Guards unrolled. Zero closures.' },
    { icon: '◉', title: 'Every runtime', desc: 'Node.js, Bun, Deno, Cloudflare Workers.' },
    { icon: '↔', title: 'Three protocols', desc: 'JSON, MessagePack, devalue. Auto negotiation.' },
  ];

  return (
    <section className="border-t border-fd-border">
      <div className="mx-auto max-w-5xl px-6 py-24">
        <h2 className="landing-hero-title mb-16 text-center text-3xl font-bold">
          Built different
        </h2>
        <div className="grid gap-px overflow-hidden rounded-2xl border border-fd-border bg-fd-border sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f, i) => (
            <div key={i} className="bg-fd-card p-7 transition hover:bg-fd-accent/30">
              <span className="mb-4 block text-xl text-amber-400 landing-mono">{f.icon}</span>
              <h3 className="mb-2 font-semibold">{f.title}</h3>
              <p className="text-sm leading-relaxed text-fd-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Code Section ─────────────────────────────────── */

function CodeSection() {
  return (
    <section className="border-t border-fd-border grid-pattern">
      <div className="mx-auto max-w-5xl px-6 py-24">
        <div className="grid items-center gap-12 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <h2 className="landing-hero-title mb-4 text-3xl font-bold">
              Minimal API
            </h2>
            <p className="mb-6 text-fd-muted-foreground leading-relaxed">
              A complete server with auth, validation,
              API docs, and WebSocket — in one file.
            </p>
            <ul className="space-y-3 text-sm">
              {[
                'Guards enrich context — no callbacks',
                'Typed errors with fail()',
                'Scalar docs at /reference',
                'WebSocket on same port',
              ].map((t, i) => (
                <li key={i} className="flex items-center gap-2 text-fd-muted-foreground">
                  <span className="text-amber-400">&#8250;</span> {t}
                </li>
              ))}
            </ul>
          </div>

          <div className="lg:col-span-3 overflow-hidden rounded-xl border border-fd-border shadow-2xl shadow-black/20">
            <div className="flex items-center border-b border-fd-border bg-fd-card px-4 py-2.5">
              <div className="flex gap-1.5">
                <div className="h-3 w-3 rounded-full bg-fd-muted-foreground/15" />
                <div className="h-3 w-3 rounded-full bg-fd-muted-foreground/15" />
                <div className="h-3 w-3 rounded-full bg-fd-muted-foreground/15" />
              </div>
              <span className="ml-3 landing-mono text-xs text-fd-muted-foreground">server.ts</span>
            </div>
            <pre className="bg-fd-card p-5 overflow-x-auto text-[13px] leading-[1.85] landing-mono">
<code className="text-fd-foreground">{`import { katman } from "katman"
import { z } from "zod"

const k = katman({
  context: (req) => ({ db: getDB() }),
})

const auth = k.guard(async (ctx) => {
  const user = await verify(ctx.headers.auth)
  if (!user) throw new KatmanError("UNAUTHORIZED")
  return { user }
})

const users = k.query(
  z.object({ limit: z.number().optional() }),
  ({ input, ctx }) => ctx.db.users.find(input)
)

k.serve(k.router({ users }), {
  port: 3000, scalar: true, ws: true
})`}</code>
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Protocols Section ────────────────────────────── */

function ProtocolsSection() {
  return (
    <section className="border-t border-fd-border">
      <div className="mx-auto max-w-5xl px-6 py-24">
        <h2 className="landing-hero-title mb-4 text-center text-3xl font-bold">
          Your protocol, your choice
        </h2>
        <p className="mx-auto mb-16 max-w-md text-center text-fd-muted-foreground">
          Automatic content negotiation. The client picks the format, the server follows.
        </p>

        <div className="grid gap-6 md:grid-cols-3">
          <ProtocolCard
            name="JSON"
            tag="default"
            desc="Universal. Fastest encode/decode. Works everywhere."
            accent="text-emerald-400"
            border="border-emerald-500/20 hover:border-emerald-500/40"
          />
          <ProtocolCard
            name="MessagePack"
            tag="binary"
            desc="30% smaller. Native Date. No competitor has this."
            accent="text-amber-400"
            border="border-amber-500/20 hover:border-amber-500/40"
          />
          <ProtocolCard
            name="devalue"
            tag="rich types"
            desc="Date, Map, Set, BigInt, RegExp, circular refs."
            accent="text-purple-400"
            border="border-purple-500/20 hover:border-purple-500/40"
          />
        </div>
      </div>
    </section>
  );
}

function ProtocolCard({ name, tag, desc, accent, border }: {
  name: string; tag: string; desc: string; accent: string; border: string;
}) {
  return (
    <div className={`rounded-xl border ${border} bg-fd-card/50 p-6 transition`}>
      <div className="mb-3 flex items-center gap-3">
        <h3 className="font-semibold">{name}</h3>
        <span className={`landing-mono text-[10px] uppercase tracking-wider ${accent}`}>{tag}</span>
      </div>
      <p className="text-sm leading-relaxed text-fd-muted-foreground">{desc}</p>
    </div>
  );
}

/* ─── CTA ──────────────────────────────────────────── */

function CTASection() {
  return (
    <section className="relative overflow-hidden border-t border-fd-border noise-overlay">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 bottom-0 -translate-x-1/2 h-[300px] w-[600px] rounded-full bg-amber-500/[0.05] blur-[120px]" />
      </div>

      <div className="relative flex flex-col items-center px-6 py-28 text-center">
        <h2 className="landing-hero-title mb-4 text-4xl font-bold">
          Start building
        </h2>
        <p className="mb-10 max-w-md text-fd-muted-foreground">
          Your first type-safe API in under five minutes.
        </p>
        <Link
          to="/docs/$"
          params={{ _splat: 'getting-started' }}
          className="group relative overflow-hidden rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 px-8 py-3 text-sm font-semibold text-black shadow-lg shadow-amber-500/20 transition hover:shadow-amber-500/30"
        >
          Read the documentation
          <span className="absolute inset-0 bg-white/10 opacity-0 transition group-hover:opacity-100" />
        </Link>
      </div>
    </section>
  );
}
