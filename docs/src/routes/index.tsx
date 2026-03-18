import { createFileRoute, Link } from '@tanstack/react-router';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '@/lib/layout.shared';
import { useState } from 'react';

export const Route = createFileRoute('/')({ component: Home });

function Home() {
  return (
    <HomeLayout {...baseOptions()}>
      <div className="k-sans">
        <Hero />
        <Div />
        <Layers />
        <Div />
        <DX />
        <Div />
        <Protocols />
        <Div />
        <Closing />
      </div>
    </HomeLayout>
  );
}

/* ═══ HERO ═════════════════════════════════════════════ */

function Hero() {
  const [pm, setPm] = useState<'pnpm' | 'npm' | 'bun'>('pnpm');
  const cmd = { pnpm: 'pnpm add katman', npm: 'npm i katman', bun: 'bun add katman' };

  return (
    <section className="relative overflow-hidden k-grain k-strata">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-[-20%] -translate-x-1/2 w-[min(900px,100vw)] aspect-square rounded-full bg-[var(--k-accent)] opacity-[0.04] blur-[160px]" />
      </div>

      <div className="relative mx-auto max-w-[1080px] px-6 pt-32 pb-28 lg:pt-40 lg:pb-36">
        <p className="k-reveal k-mono text-[11px] uppercase tracking-[.25em] text-[var(--k-dim)] mb-8">
          Type-safe RPC for TypeScript
        </p>

        <h1 className="k-reveal-1 k-serif text-[clamp(3rem,8vw,6.5rem)] leading-[0.95] tracking-[-0.02em] mb-8">
          Build in<br /><em className="text-[var(--k-accent)]">layers.</em>
        </h1>

        <p className="k-reveal-2 max-w-md text-[var(--k-warm)] text-lg leading-relaxed mb-12">
          Katman compiles your guards and middleware into a pre&#8209;linked
          pipeline at startup. Define once, run everywhere.
        </p>

        <div className="k-reveal-3 flex flex-wrap items-center gap-4 mb-16">
          <Link to="/docs/$" params={{ _splat: '' }}
            className="px-7 py-3 text-sm font-semibold text-black rounded-full bg-[var(--k-accent)] shadow-[0_0_32px_rgba(240,198,116,.15)] transition-shadow hover:shadow-[0_0_48px_rgba(240,198,116,.25)]">
            Get started
          </Link>
          <a href="https://github.com/productdevbook/katman" target="_blank" rel="noopener noreferrer"
            className="px-7 py-3 text-sm font-medium rounded-full border border-[var(--k-line)] text-[var(--k-warm)] transition hover:border-[var(--k-warm)]/30 hover:text-[var(--k-cream)]">
            View source
          </a>
        </div>

        <div className="k-reveal-4 inline-flex flex-col rounded-2xl border border-[var(--k-line)] bg-[#0e0d0b]/80 backdrop-blur-md shadow-[0_24px_80px_rgba(0,0,0,.4)]">
          <div className="flex border-b border-[var(--k-line)]">
            {(Object.keys(cmd) as Array<keyof typeof cmd>).map((k) => (
              <button key={k} onClick={() => setPm(k)}
                className={`k-mono px-5 py-2.5 text-[11px] transition-colors ${pm === k ? 'text-[var(--k-accent)]' : 'text-[var(--k-dim)] hover:text-[var(--k-warm)]'}`}>
                {k}
              </button>
            ))}
          </div>
          <div className="px-5 py-3.5 k-mono text-sm">
            <span className="text-[var(--k-dim)]">❯ </span>
            <span className="text-[var(--k-cream)]">{cmd[pm]}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ═══ LAYERS ══════════════════════════════════════════ */

function Layers() {
  return (
    <section className="relative k-grain">
      <div className="mx-auto max-w-[1080px] px-6 py-28 lg:py-36">
        <div className="grid gap-20 lg:grid-cols-[1fr,1.2fr] items-center">
          <div>
            <p className="k-mono text-[11px] uppercase tracking-[.25em] text-[var(--k-dim)] mb-6">Architecture</p>
            <h2 className="k-serif text-4xl lg:text-5xl leading-[1.05] tracking-[-0.02em] mb-6">
              Three layers,<br /><em className="text-[var(--k-accent)]">one package</em>
            </h2>
            <p className="text-[var(--k-warm)] leading-relaxed mb-10">
              <em className="k-serif text-[var(--k-cream)]">Katman</em> means <em className="k-serif">layer</em> in Turkish.
              Your API is organized into composable strata — each with its own responsibility, all type&#8209;safe end to end.
            </p>
            <div className="space-y-6">
              <LR n="01" c="#f0c674" t="Guards" d="Enrich context. Return { user }, { permissions }. Flat — no callbacks." />
              <LR n="02" c="#8abeb7" t="Pipeline" d="Compiled at startup. Guards unrolled. Wraps pre-linked. Zero closures." />
              <LR n="03" c="#c9a0dc" t="Transport" d="HTTP, HTTP/2, WebSocket. JSON, MessagePack, devalue. Auto negotiation." />
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-8 rounded-3xl bg-[var(--k-accent)]/[.03] blur-3xl k-breathe" />
            <div className="relative rounded-2xl border border-[var(--k-line)] bg-[#0e0d0b] shadow-[0_32px_80px_rgba(0,0,0,.5)] overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3 border-b border-[var(--k-line)]">
                <div className="flex gap-[6px]">
                  <i className="block w-[10px] h-[10px] rounded-full bg-white/[.07]" />
                  <i className="block w-[10px] h-[10px] rounded-full bg-white/[.07]" />
                  <i className="block w-[10px] h-[10px] rounded-full bg-white/[.07]" />
                </div>
                <span className="k-mono text-[11px] text-[var(--k-dim)] ml-2">server.ts</span>
              </div>
              <pre className="k-code k-mono p-6 text-[13px] leading-[1.9] overflow-x-auto" dangerouslySetInnerHTML={{ __html: CODE }} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function LR({ n, c, t, d }: { n: string; c: string; t: string; d: string }) {
  return (
    <div className="flex items-start gap-4 group">
      <div className="flex flex-col items-center pt-1">
        <span className="k-mono text-[10px] text-[var(--k-dim)]">{n}</span>
        <div className="mt-1.5 w-px h-full bg-[var(--k-line)] group-last:hidden" />
      </div>
      <div>
        <h3 className="font-semibold text-[var(--k-cream)] mb-1 flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: c }} />{t}
        </h3>
        <p className="text-sm text-[var(--k-dim)] leading-relaxed">{d}</p>
      </div>
    </div>
  );
}

const CODE = `<span class="kw">import</span> <span class="tx">{ katman }</span> <span class="kw">from</span> <span class="st">'katman'</span>
<span class="kw">import</span> <span class="tx">{ z }</span> <span class="kw">from</span> <span class="st">'zod'</span>

<span class="kw">const</span> <span class="tx">k = </span><span class="fn">katman</span><span class="tx">({</span>
  <span class="tx">context: (req) =&gt; ({ db: </span><span class="fn">getDB</span><span class="tx">() }),</span>
<span class="tx">})</span>

<span class="cm">// Guard — returns context additions</span>
<span class="kw">const</span> <span class="tx">auth = k.</span><span class="fn">guard</span><span class="tx">(</span><span class="kw">async</span> <span class="tx">(ctx) =&gt; {</span>
  <span class="kw">const</span> <span class="tx">user = </span><span class="kw">await</span> <span class="fn">verify</span><span class="tx">(ctx.headers.auth)</span>
  <span class="kw">if</span> <span class="tx">(!user) </span><span class="kw">throw new</span> <span class="fn">KatmanError</span><span class="tx">(</span><span class="st">'UNAUTHORIZED'</span><span class="tx">)</span>
  <span class="kw">return</span> <span class="tx">{ user }</span>
<span class="tx">})</span>

<span class="cm">// Procedure — typed end-to-end</span>
<span class="kw">const</span> <span class="tx">users = k.</span><span class="fn">query</span><span class="tx">(</span>
  <span class="tx">z.</span><span class="fn">object</span><span class="tx">({ limit: z.</span><span class="fn">number</span><span class="tx">().</span><span class="fn">optional</span><span class="tx">() }),</span>
  <span class="tx">({ input, ctx }) =&gt; ctx.db.users.</span><span class="fn">find</span><span class="tx">(input)</span>
<span class="tx">)</span>

<span class="tx">k.</span><span class="fn">serve</span><span class="tx">(k.</span><span class="fn">router</span><span class="tx">({ users }), {</span>
  <span class="tx">port: </span><span class="nr">3000</span><span class="tx">, scalar: </span><span class="kw">true</span><span class="tx">, ws: </span><span class="kw">true</span>
<span class="tx">})</span>`;

/* ═══ DX GRID ═════════════════════════════════════════ */

function DX() {
  const items = [
    { l: 'End-to-end types', d: 'Input, output, context, errors. Inferred — not generated.' },
    { l: 'Single package', d: 'Server, client, plugins, codecs. One npm install.' },
    { l: 'Standard Schema', d: 'Zod, Valibot, ArkType. Bring your own.' },
    { l: 'Compiled guards', d: 'Unrolled at startup. Zero closures per request.' },
    { l: 'Every runtime', d: 'Node, Bun, Deno, Cloudflare Workers.' },
    { l: 'Scalar docs', d: 'OpenAPI 3.1 + interactive UI at /reference.' },
  ];

  return (
    <section className="relative k-grain">
      <div className="mx-auto max-w-[1080px] px-6 py-28 lg:py-36">
        <p className="k-mono text-[11px] uppercase tracking-[.25em] text-[var(--k-dim)] mb-6">Developer experience</p>
        <h2 className="k-serif text-4xl lg:text-5xl leading-[1.05] tracking-[-0.02em] mb-20">
          Less ceremony,<br /><em className="text-[var(--k-accent)]">more building</em>
        </h2>
        <div className="grid gap-px sm:grid-cols-2 lg:grid-cols-3 rounded-2xl overflow-hidden border border-[var(--k-line)]">
          {items.map((item, i) => (
            <div key={i} className="p-8 bg-[#0e0d0b] transition-colors hover:bg-[#13120f] k-shimmer">
              <p className="k-mono text-[10px] uppercase tracking-[.2em] text-[var(--k-dim)] mb-3">0{i + 1}</p>
              <h3 className="font-semibold text-[var(--k-cream)] mb-2">{item.l}</h3>
              <p className="text-sm text-[var(--k-dim)] leading-relaxed">{item.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ═══ PROTOCOLS ═══════════════════════════════════════ */

function Protocols() {
  return (
    <section className="relative k-grain">
      <div className="mx-auto max-w-[1080px] px-6 py-28 lg:py-36">
        <p className="k-mono text-[11px] uppercase tracking-[.25em] text-[var(--k-dim)] mb-6">Wire formats</p>
        <h2 className="k-serif text-4xl lg:text-5xl leading-[1.05] tracking-[-0.02em] mb-6">
          Choose your<br /><em className="text-[var(--k-accent)]">protocol</em>
        </h2>
        <p className="text-[var(--k-warm)] max-w-md leading-relaxed mb-16">
          The server negotiates automatically. Send an Accept header — get the format you want.
        </p>
        <div className="grid gap-6 md:grid-cols-3">
          <PC n="JSON" b="default" c="#a8c97f" ls={['Universal compatibility', 'Fastest encode/decode', 'Zero config']} />
          <PC n="MessagePack" b="binary" c="var(--k-accent)" ls={['30% smaller payloads', 'Native Date support', 'binary: true']} />
          <PC n="devalue" b="rich types" c="#c9a0dc" ls={['Date, Map, Set, BigInt', 'RegExp, circular refs', '2.7× faster than superjson']} />
        </div>
      </div>
    </section>
  );
}

function PC({ n, b, c, ls }: { n: string; b: string; c: string; ls: string[] }) {
  return (
    <div className="rounded-2xl border border-[var(--k-line)] bg-[#0e0d0b] p-7 transition hover:border-white/[.08]">
      <div className="flex items-center gap-3 mb-5">
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.startsWith('var') ? undefined : c, color: c.startsWith('var') ? c : undefined }} />
        <h3 className="font-semibold text-[var(--k-cream)]">{n}</h3>
        <span className="k-mono text-[10px] uppercase tracking-[.15em]" style={{ color: c }}>{b}</span>
      </div>
      <ul className="space-y-2">
        {ls.map((l, i) => (
          <li key={i} className="text-sm text-[var(--k-dim)] flex items-center gap-2">
            <span className="w-1 h-1 rounded-full bg-[var(--k-line)]" />{l}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ═══ CTA ═════════════════════════════════════════════ */

function Closing() {
  return (
    <section className="relative k-grain overflow-hidden">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 bottom-[-30%] -translate-x-1/2 w-[600px] aspect-square rounded-full bg-[var(--k-accent)] opacity-[0.03] blur-[140px]" />
      </div>
      <div className="relative mx-auto max-w-[1080px] px-6 py-32 lg:py-40 text-center">
        <h2 className="k-serif text-4xl lg:text-6xl leading-[1] tracking-[-0.02em] mb-6">
          Your first API,<br /><em className="text-[var(--k-accent)]">in five minutes</em>
        </h2>
        <p className="text-[var(--k-warm)] mb-12 max-w-sm mx-auto">
          Follow the guide. Define a procedure. Start the server.
        </p>
        <Link to="/docs/$" params={{ _splat: '' }}
          className="inline-flex px-8 py-3.5 text-sm font-semibold text-black rounded-full bg-[var(--k-accent)] shadow-[0_0_40px_rgba(240,198,116,.12)] transition-shadow hover:shadow-[0_0_56px_rgba(240,198,116,.22)]">
          Read the documentation
        </Link>
      </div>
    </section>
  );
}

/* ═══ DIVIDER ═════════════════════════════════════════ */

function Div() {
  return (
    <div className="mx-auto max-w-[1080px] px-6">
      <div className="h-px bg-[var(--k-line)] k-line-grow" />
    </div>
  );
}
