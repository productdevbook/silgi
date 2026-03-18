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
  yarn: 'yarn add katman',
  bun: 'bun add katman',
};

function Home() {
  const [pm, setPm] = useState('npm');

  return (
    <HomeLayout {...baseOptions()}>
      {/* Hero — split layout */}
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 pt-20 pb-16 lg:grid-cols-2 lg:pt-28">
        {/* Left */}
        <div>
          <h1 className="mb-5 text-4xl font-bold tracking-tight lg:text-5xl xl:text-6xl">
            The RPC Framework
            <br />
            for TypeScript
          </h1>
          <p className="mb-8 max-w-md text-lg leading-relaxed text-fd-muted-foreground">
            Katman is a type-safe RPC framework with compiled pipelines,
            multiple protocols, and a single-package developer experience.
          </p>

          <div className="mb-10 flex gap-3">
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

          {/* Install command */}
          <div className="max-w-md overflow-hidden rounded-xl border bg-fd-card">
            <div className="flex gap-1 border-b px-2">
              {Object.keys(installCommands).map((key) => (
                <button
                  key={key}
                  onClick={() => setPm(key)}
                  className={`px-3 py-2 text-xs font-medium transition ${
                    pm === key
                      ? 'border-b-2 border-fd-primary text-fd-foreground'
                      : 'text-fd-muted-foreground hover:text-fd-foreground'
                  }`}
                >
                  {key}
                </button>
              ))}
            </div>
            <div className="px-4 py-3">
              <code className="text-sm text-fd-primary">
                <span className="text-fd-muted-foreground">$ </span>
                {installCommands[pm]}
              </code>
            </div>
          </div>
        </div>

        {/* Right — isometric illustration */}
        <div className="hidden lg:flex items-center justify-center">
          <HeroIllustration />
        </div>
      </section>

      {/* Features */}
      <section className="border-t bg-fd-card/30">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <h2 className="mb-3 text-center text-3xl font-bold">
            Developer experience,
            <br />
            <span className="text-fd-muted-foreground">without compromise</span>
          </h2>
          <p className="mx-auto mb-16 max-w-lg text-center text-fd-muted-foreground">
            Katman gives you type safety, performance, and simplicity — all in one package.
          </p>

          <div className="grid gap-px overflow-hidden rounded-2xl border bg-fd-border sm:grid-cols-2 lg:grid-cols-3">
            <Feature
              title="End-to-end types"
              description="Input, output, context, errors — typed from server to client. No codegen. No runtime overhead."
            />
            <Feature
              title="Single package"
              description="One install. Server, client, plugins, codecs — all included. No @scope/server + @scope/client."
            />
            <Feature
              title="Standard Schema"
              description="Bring your validator. Zod, Valibot, ArkType — all work through the Standard Schema spec."
            />
            <Feature
              title="Three protocols"
              description="JSON by default. MessagePack for binary. devalue for rich types. Automatic content negotiation."
            />
            <Feature
              title="Every runtime"
              description="Node.js, Bun, Deno, Cloudflare Workers. The Fetch API handler works everywhere."
            />
            <Feature
              title="Compiled pipeline"
              description="Middleware is pre-linked at startup. Guards are unrolled. Zero closures per request."
            />
          </div>
        </div>
      </section>

      {/* Code */}
      <section className="mx-auto max-w-6xl px-6 py-24">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <h2 className="mb-3 text-3xl font-bold">Simple by design</h2>
            <p className="mb-6 text-fd-muted-foreground leading-relaxed">
              A complete API with authentication, validation, and documentation — in a single file.
              No boilerplate. No ceremony.
            </p>
            <ul className="space-y-3 text-sm text-fd-muted-foreground">
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-fd-primary">&#10003;</span>
                Guards enrich context — no onion callbacks
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-fd-primary">&#10003;</span>
                Typed errors with fail() — caught by the compiler
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-fd-primary">&#10003;</span>
                Scalar API docs at /reference — zero config
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-fd-primary">&#10003;</span>
                WebSocket on the same port — one flag
              </li>
            </ul>
          </div>

          <div className="overflow-hidden rounded-xl border">
            <div className="flex items-center gap-2 border-b bg-fd-muted/30 px-4 py-2.5">
              <div className="h-3 w-3 rounded-full bg-fd-muted-foreground/20" />
              <div className="h-3 w-3 rounded-full bg-fd-muted-foreground/20" />
              <div className="h-3 w-3 rounded-full bg-fd-muted-foreground/20" />
              <span className="ml-2 text-xs text-fd-muted-foreground">server.ts</span>
            </div>
            <pre className="overflow-x-auto p-5 text-[13px] leading-relaxed">
              <code>{`import { katman } from "katman"
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

k.serve(
  k.router({ users }),
  { port: 3000, scalar: true, ws: true }
)`}</code>
            </pre>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t">
        <div className="flex flex-col items-center px-6 py-24 text-center">
          <h2 className="mb-4 text-3xl font-bold">Ready to build?</h2>
          <p className="mb-8 max-w-md text-fd-muted-foreground">
            Follow the guide and have your first type-safe API running in under five minutes.
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

function Feature({ title, description }: { title: string; description: string }) {
  return (
    <div className="bg-fd-card p-6 lg:p-8">
      <h3 className="mb-2 font-semibold">{title}</h3>
      <p className="text-sm leading-relaxed text-fd-muted-foreground">{description}</p>
    </div>
  );
}

function HeroIllustration() {
  return (
    <svg viewBox="0 0 480 420" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full max-w-md">
      {/* Background glow */}
      <defs>
        <linearGradient id="glow" x1="240" y1="0" x2="240" y2="420">
          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.08" />
          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="hsl(var(--primary))" />
          <stop offset="100%" stopColor="#a855f7" />
        </linearGradient>
      </defs>

      <rect width="480" height="420" fill="url(#glow)" rx="24" />

      {/* Bottom layer — Server */}
      <g transform="translate(120, 260)">
        <path d="M0 40 L120 0 L240 40 L120 80 Z" fill="hsl(var(--primary))" fillOpacity="0.06" stroke="hsl(var(--primary))" strokeOpacity="0.2" strokeWidth="1" />
        <path d="M0 40 L0 70 L120 110 L120 80 Z" fill="hsl(var(--primary))" fillOpacity="0.04" stroke="hsl(var(--primary))" strokeOpacity="0.15" strokeWidth="1" />
        <path d="M240 40 L240 70 L120 110 L120 80 Z" fill="hsl(var(--primary))" fillOpacity="0.08" stroke="hsl(var(--primary))" strokeOpacity="0.15" strokeWidth="1" />
        <text x="120" y="50" textAnchor="middle" className="fill-fd-muted-foreground" fontSize="11" fontWeight="500">SERVER</text>
      </g>

      {/* Middle layer — Pipeline */}
      <g transform="translate(140, 180)">
        <path d="M0 40 L100 0 L200 40 L100 80 Z" fill="hsl(var(--primary))" fillOpacity="0.12" stroke="hsl(var(--primary))" strokeOpacity="0.4" strokeWidth="1.5" />
        <path d="M0 40 L0 70 L100 110 L100 80 Z" fill="hsl(var(--primary))" fillOpacity="0.08" stroke="hsl(var(--primary))" strokeOpacity="0.3" strokeWidth="1.5" />
        <path d="M200 40 L200 70 L100 110 L100 80 Z" fill="hsl(var(--primary))" fillOpacity="0.15" stroke="hsl(var(--primary))" strokeOpacity="0.3" strokeWidth="1.5" />
        <text x="100" y="50" textAnchor="middle" className="fill-fd-foreground" fontSize="11" fontWeight="600">PIPELINE</text>
      </g>

      {/* Top layer — Client */}
      <g transform="translate(160, 100)">
        <path d="M0 40 L80 0 L160 40 L80 80 Z" fill="hsl(var(--primary))" fillOpacity="0.2" stroke="url(#accent)" strokeWidth="2" />
        <path d="M0 40 L0 70 L80 110 L80 80 Z" fill="hsl(var(--primary))" fillOpacity="0.12" stroke="hsl(var(--primary))" strokeOpacity="0.5" strokeWidth="1.5" />
        <path d="M160 40 L160 70 L80 110 L80 80 Z" fill="hsl(var(--primary))" fillOpacity="0.25" stroke="hsl(var(--primary))" strokeOpacity="0.5" strokeWidth="1.5" />
        <text x="80" y="50" textAnchor="middle" className="fill-fd-foreground" fontSize="11" fontWeight="600">CLIENT</text>
      </g>

      {/* Floating labels */}
      <g>
        {/* JSON */}
        <rect x="40" y="160" width="52" height="24" rx="6" fill="hsl(var(--primary))" fillOpacity="0.1" stroke="hsl(var(--primary))" strokeOpacity="0.3" strokeWidth="1" />
        <text x="66" y="176" textAnchor="middle" className="fill-fd-muted-foreground" fontSize="10" fontWeight="500">JSON</text>

        {/* msgpack */}
        <rect x="370" y="200" width="72" height="24" rx="6" fill="hsl(var(--primary))" fillOpacity="0.1" stroke="hsl(var(--primary))" strokeOpacity="0.3" strokeWidth="1" />
        <text x="406" y="216" textAnchor="middle" className="fill-fd-muted-foreground" fontSize="10" fontWeight="500">msgpack</text>

        {/* WS */}
        <rect x="380" y="130" width="42" height="24" rx="6" fill="hsl(var(--primary))" fillOpacity="0.1" stroke="hsl(var(--primary))" strokeOpacity="0.3" strokeWidth="1" />
        <text x="401" y="146" textAnchor="middle" className="fill-fd-muted-foreground" fontSize="10" fontWeight="500">WS</text>

        {/* Types */}
        <rect x="30" y="90" width="60" height="24" rx="6" fill="hsl(var(--primary))" fillOpacity="0.15" stroke="url(#accent)" strokeWidth="1" />
        <text x="60" y="106" textAnchor="middle" className="fill-fd-foreground" fontSize="10" fontWeight="600">Types</text>

        {/* Zod */}
        <rect x="60" y="310" width="42" height="24" rx="6" fill="hsl(var(--primary))" fillOpacity="0.1" stroke="hsl(var(--primary))" strokeOpacity="0.3" strokeWidth="1" />
        <text x="81" y="326" textAnchor="middle" className="fill-fd-muted-foreground" fontSize="10" fontWeight="500">Zod</text>

        {/* Guard */}
        <rect x="390" y="290" width="56" height="24" rx="6" fill="hsl(var(--primary))" fillOpacity="0.1" stroke="hsl(var(--primary))" strokeOpacity="0.3" strokeWidth="1" />
        <text x="418" y="306" textAnchor="middle" className="fill-fd-muted-foreground" fontSize="10" fontWeight="500">Guard</text>
      </g>

      {/* Connection dots */}
      <circle cx="240" cy="80" r="3" fill="hsl(var(--primary))" fillOpacity="0.4" />
      <circle cx="240" cy="170" r="3" fill="hsl(var(--primary))" fillOpacity="0.3" />
      <circle cx="240" cy="250" r="3" fill="hsl(var(--primary))" fillOpacity="0.2" />

      {/* Vertical connection line */}
      <line x1="240" y1="83" x2="240" y2="167" stroke="hsl(var(--primary))" strokeOpacity="0.15" strokeWidth="1" strokeDasharray="4 4" />
      <line x1="240" y1="173" x2="240" y2="247" stroke="hsl(var(--primary))" strokeOpacity="0.1" strokeWidth="1" strokeDasharray="4 4" />
    </svg>
  );
}
