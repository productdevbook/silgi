import { createFileRoute, Link } from '@tanstack/react-router';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '@/lib/layout.shared';

export const Route = createFileRoute('/')({
  component: Home,
});

function Home() {
  return (
    <HomeLayout {...baseOptions()}>
      {/* Hero */}
      <section className="flex flex-col items-center px-4 pt-24 pb-16 text-center">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-fd-primary/20 bg-fd-primary/5 px-4 py-1.5 text-sm text-fd-primary">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-fd-primary opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-fd-primary" />
          </span>
          v0.1.0 — Now available
        </div>

        <h1 className="mb-6 max-w-3xl text-4xl font-bold tracking-tight md:text-6xl">
          Type-safe RPC
          <br />
          <span className="bg-gradient-to-r from-fd-primary to-purple-500 bg-clip-text text-transparent">
            built for speed
          </span>
        </h1>

        <p className="mb-10 max-w-xl text-lg text-fd-muted-foreground leading-relaxed">
          Define procedures in TypeScript. Get end-to-end type safety from server to client.
          Ship as a single package with zero configuration.
        </p>

        <div className="flex gap-3">
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
            GitHub
          </a>
        </div>
      </section>

      {/* Architecture Illustration */}
      <section className="mx-auto max-w-4xl px-4 py-12">
        <div className="relative overflow-hidden rounded-2xl border bg-fd-card p-8 md:p-12">
          <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-fd-primary/5 blur-3xl" />
          <div className="absolute -left-16 -bottom-16 h-64 w-64 rounded-full bg-purple-500/5 blur-3xl" />

          <div className="relative grid gap-8 md:grid-cols-3">
            {/* Server */}
            <div className="flex flex-col items-center text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl border bg-fd-background">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-fd-primary"><rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/></svg>
              </div>
              <h3 className="mb-1 font-semibold">Define</h3>
              <p className="text-sm text-fd-muted-foreground">
                Write procedures with guards, validation, and typed errors
              </p>
            </div>

            {/* Arrow */}
            <div className="hidden items-center justify-center md:flex">
              <div className="flex flex-col items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="24" viewBox="0 0 48 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-fd-muted-foreground/40">
                  <path d="M0 12h44m0 0l-6-6m6 6l-6 6" />
                </svg>
                <span className="text-xs text-fd-muted-foreground/60">compiled pipeline</span>
              </div>
            </div>

            {/* Client */}
            <div className="flex flex-col items-center text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl border bg-fd-background">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-fd-primary"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m10 16 5-4-5-4"/></svg>
              </div>
              <h3 className="mb-1 font-semibold">Consume</h3>
              <p className="text-sm text-fd-muted-foreground">
                Full autocomplete on the client — types inferred, not generated
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-5xl px-4 py-16">
        <h2 className="mb-2 text-center text-2xl font-bold">Everything you need</h2>
        <p className="mb-12 text-center text-fd-muted-foreground">
          One install. No boilerplate. Production-ready from day one.
        </p>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FeatureCard
            icon={<TypeSafeIcon />}
            title="End-to-end type safety"
            description="Input, output, context, and errors — fully typed from server to client without codegen."
          />
          <FeatureCard
            icon={<PackageIcon />}
            title="Single package"
            description="One npm install. No monorepo of @scope/server + @scope/client + @scope/contract."
          />
          <FeatureCard
            icon={<SchemaIcon />}
            title="Standard Schema"
            description="Works with Zod, Valibot, and ArkType via the Standard Schema specification."
          />
          <FeatureCard
            icon={<ProtocolIcon />}
            title="Multiple protocols"
            description="JSON, MessagePack binary, devalue rich types. Content negotiation is automatic."
          />
          <FeatureCard
            icon={<RuntimeIcon />}
            title="Every runtime"
            description="Node.js, Bun, Deno, Cloudflare Workers. Fetch API handler works everywhere."
          />
          <FeatureCard
            icon={<PluginIcon />}
            title="Extensible"
            description="Guards, wraps, hooks, plugins. CORS, OTel, rate limiting, logging — all built-in."
          />
        </div>
      </section>

      {/* Code Preview */}
      <section className="mx-auto max-w-3xl px-4 py-16">
        <h2 className="mb-2 text-center text-2xl font-bold">Simple by design</h2>
        <p className="mb-8 text-center text-fd-muted-foreground">
          A complete API in 15 lines.
        </p>
        <div className="overflow-hidden rounded-xl border">
          <div className="flex items-center gap-2 border-b bg-fd-muted/30 px-4 py-2.5">
            <div className="h-3 w-3 rounded-full bg-red-400/60" />
            <div className="h-3 w-3 rounded-full bg-yellow-400/60" />
            <div className="h-3 w-3 rounded-full bg-green-400/60" />
            <span className="ml-2 text-xs text-fd-muted-foreground">server.ts</span>
          </div>
          <pre className="overflow-x-auto p-4 text-sm leading-relaxed">
            <code>{`import { katman } from "katman"
import { z } from "zod"

const k = katman({ context: (req) => ({ db: getDB() }) })

const users = k.query(
  z.object({ limit: z.number().optional() }),
  ({ input, ctx }) => ctx.db.users.findMany({ take: input.limit })
)

k.serve(k.router({ users }), { port: 3000, scalar: true })`}</code>
          </pre>
        </div>
      </section>

      {/* CTA */}
      <section className="flex flex-col items-center px-4 py-20 text-center">
        <h2 className="mb-4 text-2xl font-bold">Ready to build?</h2>
        <p className="mb-8 text-fd-muted-foreground">
          Set up your first API in under 5 minutes.
        </p>
        <Link
          to="/docs/$"
          params={{ _splat: 'getting-started' }}
          className="rounded-lg bg-fd-primary px-8 py-3 text-sm font-medium text-fd-primary-foreground shadow-sm transition hover:opacity-90"
        >
          Read the docs
        </Link>
      </section>
    </HomeLayout>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="group rounded-xl border p-6 transition hover:border-fd-primary/30 hover:bg-fd-accent/30">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg border bg-fd-background text-fd-primary transition group-hover:border-fd-primary/30">
        {icon}
      </div>
      <h3 className="mb-1 font-semibold">{title}</h3>
      <p className="text-sm text-fd-muted-foreground leading-relaxed">{description}</p>
    </div>
  );
}

function TypeSafeIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>
  );
}

function PackageIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>
  );
}

function SchemaIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22h6a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v10"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m5 17-3 3 3 3"/><path d="m9 17 3 3-3 3"/></svg>
  );
}

function ProtocolIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/></svg>
  );
}

function RuntimeIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>
  );
}

function PluginIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/></svg>
  );
}
