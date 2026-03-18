import { createFileRoute, Link } from '@tanstack/react-router';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '@/lib/layout.shared';
import { useState } from 'react';

export const Route = createFileRoute('/')({
  component: Home,
});

const installCommands: Record<string, string> = {
  npm: 'npm install katman',
  pnpm: 'pnpm add katman',
  bun: 'bun add katman',
};

function Home() {
  const [pm, setPm] = useState('pnpm');

  return (
    <HomeLayout {...baseOptions()}>
      {/* Hero */}
      <section className="relative overflow-hidden">
        {/* Gradient background */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-0 -translate-x-1/2 h-[500px] w-[800px] rounded-full bg-fd-primary/8 blur-[120px]" />
        </div>

        <div className="relative mx-auto max-w-6xl px-6 pt-24 pb-20 lg:pt-32">
          <div className="grid items-center gap-16 lg:grid-cols-2">
            {/* Left — text */}
            <div>
              <h1 className="mb-6 text-4xl font-bold tracking-tight lg:text-5xl">
                The RPC Framework
                <br />
                <span className="bg-gradient-to-r from-fd-primary to-purple-500 bg-clip-text text-transparent">
                  for TypeScript
                </span>
              </h1>

              <p className="mb-8 max-w-md text-lg leading-relaxed text-fd-muted-foreground">
                Type-safe procedures with compiled pipelines,
                multiple protocols, and a single-package developer experience.
              </p>

              <div className="mb-10 flex flex-wrap gap-3">
                <Link
                  to="/docs/$"
                  params={{ _splat: 'getting-started' }}
                  className="rounded-lg bg-fd-primary px-6 py-2.5 text-sm font-medium text-fd-primary-foreground shadow-sm transition hover:opacity-90"
                >
                  Get Started
                </Link>
                <a
                  href="https://github.com/productdevbook/katman"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg border px-6 py-2.5 text-sm font-medium transition hover:bg-fd-accent"
                >
                  View on GitHub
                </a>
              </div>

              {/* Install tabs */}
              <div className="max-w-sm overflow-hidden rounded-xl border bg-fd-card shadow-sm">
                <div className="flex border-b">
                  {Object.keys(installCommands).map((key) => (
                    <button
                      key={key}
                      onClick={() => setPm(key)}
                      className={`flex-1 px-3 py-2 text-xs font-medium transition ${
                        pm === key
                          ? 'border-b-2 border-fd-primary text-fd-foreground'
                          : 'text-fd-muted-foreground hover:text-fd-foreground'
                      }`}
                    >
                      {key}
                    </button>
                  ))}
                </div>
                <div className="px-4 py-3 font-mono text-sm">
                  <span className="text-fd-muted-foreground">$ </span>
                  <span className="text-fd-primary">{installCommands[pm]}</span>
                </div>
              </div>
            </div>

            {/* Right — code preview */}
            <div className="hidden lg:block">
              <div className="overflow-hidden rounded-xl border bg-fd-card shadow-lg">
                <div className="flex items-center gap-2 border-b px-4 py-3">
                  <div className="h-3 w-3 rounded-full bg-red-400/40" />
                  <div className="h-3 w-3 rounded-full bg-yellow-400/40" />
                  <div className="h-3 w-3 rounded-full bg-green-400/40" />
                  <span className="ml-2 text-xs text-fd-muted-foreground">server.ts</span>
                </div>
                <pre className="overflow-x-auto p-5 text-[13px] leading-[1.8]">
                  <code>
                    <Line k="import" v=" { katman } " k2="from" s=" 'katman'" />
                    <Line k="import" v=" { z } " k2="from" s=" 'zod'" />
                    <br />
                    <Line k="const" v=" k = " f="katman" p="({" />
                    <Line v="  context: " p="(req) =>" v2=" ({ db: " f2="getDB" p2="() })" />
                    <Line p="})" />
                    <br />
                    <Line k="const" v=" auth = k." f="guard" p="(" k2="async" v2=" (ctx) =>" p2=" {" />
                    <Line v="  " k="const" v2=" user = " k2="await" v3=" " f="verify" p="(ctx.headers.auth)" />
                    <Line v="  " k="if" v2=" (!user) " k2="throw new" v3=" " f="KatmanError" p="('UNAUTHORIZED')" />
                    <Line v="  " k="return" v2=" { user }" />
                    <Line p="})" />
                    <br />
                    <Line k="const" v=" users = k." f="query" p="(" />
                    <Line v="  z." f="object" p="({ limit: z.number().optional() })," />
                    <Line v="  ({ input, ctx }) => ctx.db.users." f="find" p="(input)" />
                    <Line p=")" />
                    <br />
                    <Line v="k." f="serve" p="(k.router({ users }), {" />
                    <Line v="  port: " n="3000" p="," v2=" scalar: " k="true" p2="," v3=" ws: " k2="true" />
                    <Line p="})" />
                  </code>
                </pre>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <h2 className="mb-4 text-center text-3xl font-bold">
            Everything you need
          </h2>
          <p className="mx-auto mb-16 max-w-lg text-center text-fd-muted-foreground">
            One package, zero configuration, production-ready.
          </p>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <Card
              emoji="🔒"
              title="End-to-end type safety"
              desc="Input, output, context, and errors — typed from server to client without codegen."
            />
            <Card
              emoji="📦"
              title="Single package"
              desc="Server, client, plugins, codecs. One install. No monorepo of scoped packages."
            />
            <Card
              emoji="✅"
              title="Standard Schema"
              desc="Zod, Valibot, ArkType — bring your validator. Standard Schema just works."
            />
            <Card
              emoji="⚡"
              title="Compiled pipeline"
              desc="Middleware pre-linked at startup. Guards unrolled. Zero closures per request."
            />
            <Card
              emoji="🌐"
              title="Every runtime"
              desc="Node.js, Bun, Deno, Cloudflare Workers. Fetch API handler runs everywhere."
            />
            <Card
              emoji="🔌"
              title="Three protocols"
              desc="JSON, MessagePack binary, devalue rich types. Automatic content negotiation."
            />
          </div>
        </div>
      </section>

      {/* Capabilities */}
      <section className="border-t bg-fd-card/30">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Pipeline latency" value="111 ns" />
            <Stat label="HTTP latency" value="78 µs" />
            <Stat label="Bun handler" value="2 µs" />
            <Stat label="WebSocket" value="39 µs" />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t">
        <div className="flex flex-col items-center px-6 py-24 text-center">
          <h2 className="mb-4 text-3xl font-bold">Start building</h2>
          <p className="mb-8 max-w-md text-fd-muted-foreground">
            Your first type-safe API in under five minutes.
          </p>
          <Link
            to="/docs/$"
            params={{ _splat: 'getting-started' }}
            className="rounded-lg bg-fd-primary px-8 py-3 text-sm font-medium text-fd-primary-foreground shadow-sm transition hover:opacity-90"
          >
            Read the documentation
          </Link>
        </div>
      </section>
    </HomeLayout>
  );
}

/* Syntax-highlighted code line component */
function Line({ k, v, k2, v2, k3, v3, f, f2, p, p2, s, n }: {
  k?: string; v?: string; k2?: string; v2?: string; k3?: string; v3?: string;
  f?: string; f2?: string; p?: string; p2?: string; s?: string; n?: string;
}) {
  return (
    <span className="block">
      {k && <span className="text-purple-400">{k}</span>}
      {v && <span className="text-fd-foreground">{v}</span>}
      {f && <span className="text-yellow-300">{f}</span>}
      {k2 && <span className="text-purple-400">{k2}</span>}
      {v2 && <span className="text-fd-foreground">{v2}</span>}
      {f2 && <span className="text-yellow-300">{f2}</span>}
      {k3 && <span className="text-purple-400">{k3}</span>}
      {v3 && <span className="text-fd-foreground">{v3}</span>}
      {s && <span className="text-green-400">{s}</span>}
      {n && <span className="text-orange-300">{n}</span>}
      {p && <span className="text-fd-muted-foreground">{p}</span>}
      {p2 && <span className="text-fd-muted-foreground">{p2}</span>}
    </span>
  );
}

function Card({ emoji, title, desc }: { emoji: string; title: string; desc: string }) {
  return (
    <div className="rounded-xl border p-6 transition hover:border-fd-primary/30 hover:shadow-sm">
      <span className="mb-3 block text-2xl">{emoji}</span>
      <h3 className="mb-2 font-semibold">{title}</h3>
      <p className="text-sm leading-relaxed text-fd-muted-foreground">{desc}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <p className="mb-1 text-3xl font-bold text-fd-primary">{value}</p>
      <p className="text-sm text-fd-muted-foreground">{label}</p>
    </div>
  );
}
