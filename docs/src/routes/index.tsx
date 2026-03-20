import { baseOptions } from '@/lib/layout.shared'
import { createFileRoute, Link } from '@tanstack/react-router'
import { HomeLayout } from 'fumadocs-ui/layouts/home'
import { useState } from 'react'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return (
    <HomeLayout {...baseOptions()}>
      <div className='k-sans max-w-6xl mx-auto k-landing'>
        <Hero />
        <SponsorBanner />
        <Heading label='Architecture' title='Build your API in composable layers' />
        <ArchitectureGrid />
        <Heading label='Developer experience' title='From zero to production' />
        <DXGrid />
        <Heading label='Wire formats' title='Three protocols, automatic negotiation' />
        <ProtocolGrid />
        <Heading label='Integrations' title='Works with your stack' />
        <IntegrationGrid />
        <SponsorsInline />
        <Heading label='Server' title='One line to deploy' />
        <ServerGrid />
        <Heading label='Plugins' title='Extend without ceremony' />
        <PluginGrid />
        <SponsorsSection />
        <FooterCTA />
      </div>
    </HomeLayout>
  )
}

/* ═══ HERO ═══════════════════════════════════════════ */

function Hero() {
  const [pm, setPm] = useState<'pnpm' | 'npm' | 'bun'>('pnpm')
  const cmd = { npm: 'npm i silgi', pnpm: 'pnpm add silgi', bun: 'bun add silgi' }

  return (
    <section className='relative overflow-hidden k-grain'>
      <W ticks>
        <div className='grid md:grid-cols-2'>
          <div className='flex flex-col justify-between gap-16 p-6 sm:p-10'>
            <div className='flex flex-col gap-5 items-center md:items-start text-center md:text-left'>
              <span className='k-mono text-xs uppercase tracking-[.3em] text-[var(--k-dim)]'>
                Type-safe RPC for TypeScript
              </span>
              <h1 className='k-serif text-[clamp(2.5rem,6vw,4.5rem)] leading-[0.95] tracking-[-0.02em] max-w-[22rem] k-shine'>
                The RPC Framework for the Web
              </h1>
              <p className='text-[var(--k-text)] md:text-lg max-w-[27rem] text-pretty font-normal leading-relaxed'>
                Silgi is a type-safe RPC framework with compiled pipelines powering the next generation of TypeScript
                APIs.
              </p>
              <div className='flex items-center gap-4 mt-6'>
                <Link to='/docs/$' params={{ _splat: '' }} className='k-btn k-btn--primary'>
                  Get Started
                </Link>
                <a
                  href='https://github.com/productdevbook/silgi'
                  target='_blank'
                  rel='noopener noreferrer'
                  className='k-btn k-btn--ghost'
                >
                  View on GitHub
                </a>
              </div>
            </div>

            <div className='hidden md:block w-full -mb-[1px]'>
              <div className='rounded-lg border border-[var(--k-line)] bg-[var(--k-raised)] overflow-hidden'>
                <div className='flex border-b border-[var(--k-line)]'>
                  {(Object.keys(cmd) as Array<keyof typeof cmd>).map((k) => (
                    <button
                      key={k}
                      onClick={() => setPm(k)}
                      className={`k-mono flex-1 px-4 py-2 text-xs uppercase tracking-[.12em] transition-colors ${pm === k ? 'text-[var(--k-accent)] bg-[var(--k-line)]' : 'text-[var(--k-dim)] hover:text-[var(--k-text)]'}`}
                    >
                      {k}
                    </button>
                  ))}
                </div>
                <div className='px-4 py-3 k-mono text-sm flex items-center justify-between text-[var(--k-fg)]'>
                  <span>
                    <span className='text-[var(--k-dim)]'>$ </span>
                    {cmd[pm]}
                  </span>
                  <span className='text-[var(--k-dim)] text-xs'>bash</span>
                </div>
              </div>
            </div>
          </div>

          <div className='relative border-l border-[var(--k-line)] overflow-hidden'>
            <pre
              className='k-code k-mono relative p-6 sm:p-10 text-[12.5px] leading-[1.9] overflow-x-auto min-h-[24rem]'
              dangerouslySetInnerHTML={{ __html: CODE }}
            />
          </div>
        </div>
      </W>
    </section>
  )
}

const CODE = [
  '<span class="kw">import</span> { silgi } <span class="kw">from</span> <span class="st">\'silgi\'</span>',
  '<span class="kw">import</span> { z } <span class="kw">from</span> <span class="st">\'zod\'</span>',
  '',
  '<span class="kw">const</span> k = <span class="fn">silgi</span>({',
  '  context: (req) =&gt; ({ db: <span class="fn">getDB</span>() }),',
  '})',
  '',
  '<span class="cm">// Guard — flat, no callbacks</span>',
  '<span class="kw">const</span> auth = k.<span class="fn">guard</span>(<span class="kw">async</span> (ctx) =&gt; {',
  '  <span class="kw">const</span> user = <span class="kw">await</span> <span class="fn">verify</span>(ctx.headers.auth)',
  '  <span class="kw">if</span> (!user) <span class="kw">throw new</span> <span class="fn">SilgiError</span>(<span class="st">\'UNAUTHORIZED\'</span>)',
  '  <span class="kw">return</span> { user }',
  '})',
  '',
  '<span class="cm">// Procedure — typed end-to-end</span>',
  '<span class="kw">const</span> users = k',
  '  .<span class="fn">$input</span>(z.<span class="fn">object</span>({ limit: z.<span class="fn">number</span>().<span class="fn">optional</span>() }))',
  '  .<span class="fn">$resolve</span>(({ input, ctx }) =&gt; ctx.db.users.<span class="fn">find</span>(input))',
  '',
  '<span class="cm">// Router &amp; serve</span>',
  '<span class="kw">const</span> appRouter = k.<span class="fn">router</span>({ users })',
  '',
  'k.<span class="fn">serve</span>(appRouter, {',
  '  port: <span class="nr">3000</span>,',
  '  scalar: <span class="kw">true</span>,',
  '  ws: <span class="kw">true</span>,',
  '})',
].join('\n')

/* ═══ SPONSOR BANNER ════════════════════════════════ */

function SponsorBanner() {
  const link = 'https://github.com/sponsors/productdevbook'
  return (
    <section>
      <W ticks className='grid grid-cols-2'>
        {[1, 2].map((i) => (
          <a
            key={i}
            href={link}
            target='_blank'
            rel='noopener noreferrer'
            className={`flex flex-col items-center justify-center gap-2 py-10 text-[var(--k-dim)] hover:text-[var(--k-accent)] transition-colors ${i === 2 ? 'border-l border-[var(--k-line)]' : ''}`}
          >
            <span className='k-mono text-[11px] uppercase tracking-[.2em]'>Special Sponsor</span>
            <span className='text-sm'>Your Company</span>
          </a>
        ))}
      </W>
    </section>
  )
}

/* ═══ HEADING ═══════════════════════════════════════ */

function Heading({ label, title }: { label: string; title: string }) {
  return (
    <section>
      <W border className='px-6 sm:px-10 py-16 lg:py-20'>
        <span className='k-mono text-xs uppercase tracking-[.3em] text-[var(--k-dim)] block mb-4'>{label}</span>
        <h2 className='k-serif text-[clamp(1.8rem,4vw,2.8rem)] leading-[1.1] tracking-[-0.015em] text-[var(--k-fg)]'>
          {title}
        </h2>
      </W>
    </section>
  )
}

/* ═══ ARCHITECTURE ══════════════════════════════════ */

function ArchitectureGrid() {
  return (
    <section>
      <W ticks className='grid md:grid-cols-2'>
        <Cell>
          <CT
            t='Guards enrich context'
            d='Return { user }, { permissions } from a flat function. No onion callbacks. Types accumulate automatically.'
          />
        </Cell>
        <Cell bl>
          <CT
            t='Compiled at startup'
            d='Guards are unrolled, wraps are pre-linked. The pipeline is a direct function chain — zero closures per request.'
          />
        </Cell>
        <Cell bt>
          <CT
            t='Types flow end-to-end'
            d='Input, output, context, errors — fully typed from server to client. Inferred from your code, never generated.'
          />
        </Cell>
        <Cell bt bl>
          <CT
            t='Standard Schema'
            d='Zod, Valibot, ArkType — bring your own validator. Works through the Standard Schema specification.'
          />
        </Cell>
      </W>
    </section>
  )
}

/* ═══ DX ════════════════════════════════════════════ */

function DXGrid() {
  return (
    <section>
      <W ticks className='grid sm:grid-cols-2 lg:grid-cols-3'>
        <Cell>
          <CT
            t='Single package'
            d='Server, client, plugins, codecs. One npm install. No monorepo of scoped packages.'
          />
        </Cell>
        <Cell bl>
          <CT
            t='Typed errors'
            d='Define error maps per procedure. fail() is typed — the compiler catches wrong codes.'
          />
        </Cell>
        <Cell bl>
          <CT
            t='Lifecycle hooks'
            d='request, response, error, serve:start — powered by hookable. Sync fast-path when unused.'
          />
        </Cell>
        <Cell bt>
          <CT
            t='Response cache'
            d='ohash-keyed TTL cache with prefix invalidation. Skip pipeline + stringify on cache hit.'
          />
        </Cell>
        <Cell bt bl>
          <CT t='Lazy loading' d="lazy(() => import('./routes/users')) for code splitting. Cached after first load." />
        </Cell>
        <Cell bt bl>
          <CT t='Contract-first' d='Define the API shape, share with frontend, implement on backend. Types enforced.' />
        </Cell>
      </W>
    </section>
  )
}

/* ═══ PROTOCOLS ═════════════════════════════════════ */

function ProtocolGrid() {
  return (
    <section>
      <W ticks className='grid md:grid-cols-3'>
        <Cell>
          <Badge c='var(--k-code-st)' t='JSON' b='default' />
          <p className='text-sm text-[var(--k-dim)] font-normal leading-relaxed mt-3'>
            Universal. Fastest encode/decode. Works everywhere. Zero config.
          </p>
        </Cell>
        <Cell bl>
          <Badge c='var(--k-accent)' t='MessagePack' b='binary' />
          <p className='text-sm text-[var(--k-dim)] font-normal leading-relaxed mt-3'>
            30% smaller payloads. Native Date. One flag:{' '}
            <code className='k-mono text-[var(--k-text)]'>binary: true</code>
          </p>
        </Cell>
        <Cell bl>
          <Badge c='var(--k-code-kw)' t='devalue' b='rich types' />
          <p className='text-sm text-[var(--k-dim)] font-normal leading-relaxed mt-3'>
            Date, Map, Set, BigInt, RegExp, circular refs. Automatic round-trip.
          </p>
        </Cell>
      </W>
    </section>
  )
}

/* ═══ INTEGRATIONS ══════════════════════════════════ */

function IntegrationGrid() {
  return (
    <section>
      <W ticks className='grid sm:grid-cols-2 lg:grid-cols-4'>
        <Cell>
          <CT t='React Actions' d='createAction() returns [error, data] tuples. FormData with bracket notation.' />
        </Cell>
        <Cell bl>
          <CT t='TanStack Query' d='queryOptions, mutationOptions, queryKey. React, Vue, Solid, Svelte.' />
        </Cell>
        <Cell bl>
          <CT t='AI SDK' d='routerToTools() — LLMs call your procedures through function calling.' />
        </Cell>
        <Cell bl>
          <CT t='Fastify' d='Register as a plugin alongside existing REST routes.' />
        </Cell>
      </W>
    </section>
  )
}

/* ═══ SPONSORS INLINE ═══════════════════════════════ */

function SponsorsInline() {
  const link = 'https://github.com/sponsors/productdevbook'
  return (
    <section>
      <W border className='p-6 sm:p-10'>
        <span className='k-mono text-xs uppercase tracking-[.3em] text-[var(--k-dim)] block mb-4'>Gold Sponsors</span>
        <div className='grid grid-cols-2 sm:grid-cols-4 gap-3'>
          {[1, 2, 3, 4].map((i) => (
            <a
              key={i}
              href={link}
              target='_blank'
              rel='noopener noreferrer'
              className='flex items-center justify-center h-16 rounded-lg border border-dashed border-[var(--k-line)] text-[var(--k-dim)] text-sm hover:border-[var(--k-accent)]/40 hover:text-[var(--k-accent)] transition-colors'
            >
              Sponsor
            </a>
          ))}
        </div>
      </W>
    </section>
  )
}

/* ═══ SERVER ════════════════════════════════════════ */

function ServerGrid() {
  return (
    <section>
      <W ticks className='grid md:grid-cols-2'>
        <Cell>
          <CT t='serve()' d='One-line Node.js server. Auto port finding, HTTP/2 with TLS, WebSocket on same port.' />
          <div className='mt-5 rounded-lg border border-[var(--k-line)] bg-[var(--k-raised)] p-4 k-mono text-[12px] text-[var(--k-dim)]'>
            <p>k.serve(router, {'{'}</p>
            <p>
              &nbsp; port: <span style={{ color: 'var(--k-code-nr)' }}>3000</span>,
            </p>
            <p>
              &nbsp; scalar: <span style={{ color: 'var(--k-code-kw)' }}>true</span>,
            </p>
            <p>
              &nbsp; ws: <span style={{ color: 'var(--k-code-kw)' }}>true</span>,
            </p>
            <p>
              &nbsp; http2: {'{'} cert, key {'}'}
            </p>
            <p>{'}'})</p>
          </div>
        </Cell>
        <Cell bl>
          <CT t='handler()' d='Fetch API handler — works everywhere. Content negotiation is automatic.' />
          <div className='mt-5 grid grid-cols-2 gap-3'>
            {['Node.js', 'Bun', 'Deno', 'Cloudflare'].map((r) => (
              <div key={r} className='rounded-lg border border-[var(--k-line)] px-4 py-2.5 text-center'>
                <span className='text-sm text-[var(--k-text)] font-normal'>{r}</span>
              </div>
            ))}
          </div>
        </Cell>
      </W>
    </section>
  )
}

/* ═══ PLUGINS ═══════════════════════════════════════ */

function PluginGrid() {
  return (
    <section>
      <W ticks className='grid sm:grid-cols-2 lg:grid-cols-4'>
        <Cell>
          <CT t='CORS' d='corsHeaders() — string, array, or dynamic origin matching.' />
        </Cell>
        <Cell bl>
          <CT t='OpenTelemetry' d='otelWrap(tracer) — each procedure call becomes a span.' />
        </Cell>
        <Cell bl>
          <CT t='Pino' d='loggingHooks() — structured request/response/error logging.' />
        </Cell>
        <Cell bl>
          <CT t='Rate Limiting' d='Sliding window guard. In-memory or custom backend.' />
        </Cell>
      </W>
    </section>
  )
}

/* ═══ SPONSORS SECTION ══════════════════════════════ */

function SponsorsSection() {
  const link = 'https://github.com/sponsors/productdevbook'
  return (
    <section>
      <W border className='p-6 sm:p-10'>
        <div className='flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-10'>
          <div>
            <span className='k-mono text-xs uppercase tracking-[.3em] text-[var(--k-dim)] block mb-3'>Sponsors</span>
            <h2 className='k-serif text-[clamp(1.6rem,3vw,2.2rem)] leading-[1.1] text-[var(--k-fg)]'>
              Backed by the community
            </h2>
          </div>
          <a href={link} target='_blank' rel='noopener noreferrer' className='k-btn k-btn--ghost'>
            Become a Sponsor
          </a>
        </div>

        {/* Platinum — large, prominent */}
        <div className='mb-6'>
          <span className='k-mono text-[11px] uppercase tracking-[.25em] text-[var(--k-dim)] block mb-3'>Platinum</span>
          <a
            href={link}
            target='_blank'
            rel='noopener noreferrer'
            className='flex items-center justify-center h-28 rounded-xl border border-dashed border-[var(--k-line)] text-[var(--k-dim)] text-sm hover:border-[var(--k-accent)]/40 hover:text-[var(--k-accent)] transition-colors'
          >
            Your logo here
          </a>
        </div>

        {/* Gold */}
        <div className='mb-6'>
          <span className='k-mono text-[11px] uppercase tracking-[.25em] text-[var(--k-dim)] block mb-3'>Gold</span>
          <div className='grid grid-cols-2 sm:grid-cols-3 gap-3'>
            {[1, 2, 3].map((i) => (
              <a
                key={i}
                href={link}
                target='_blank'
                rel='noopener noreferrer'
                className='flex items-center justify-center h-20 rounded-lg border border-dashed border-[var(--k-line)] text-[var(--k-dim)] text-sm hover:border-[var(--k-accent)]/40 hover:text-[var(--k-accent)] transition-colors'
              >
                Sponsor
              </a>
            ))}
          </div>
        </div>

        {/* Silver */}
        <div>
          <span className='k-mono text-[11px] uppercase tracking-[.25em] text-[var(--k-dim)] block mb-3'>Silver</span>
          <div className='grid grid-cols-3 sm:grid-cols-5 gap-2'>
            {[1, 2, 3, 4, 5].map((i) => (
              <a
                key={i}
                href={link}
                target='_blank'
                rel='noopener noreferrer'
                className='flex items-center justify-center h-14 rounded-lg border border-dashed border-[var(--k-line)] text-[var(--k-dim)] text-sm hover:border-[var(--k-accent)]/40 hover:text-[var(--k-accent)] transition-colors'
              >
                Sponsor
              </a>
            ))}
          </div>
        </div>
      </W>
    </section>
  )
}

/* ═══ FOOTER CTA ════════════════════════════════════ */

function FooterCTA() {
  return (
    <section className='relative k-grain overflow-hidden'>
      <W border className='relative px-6 sm:px-10 py-24 lg:py-32 text-center flex flex-col items-center'>
        <h2 className='k-serif text-[clamp(2rem,4.5vw,3.2rem)] leading-[1.05] tracking-[-0.015em] mb-4 text-[var(--k-fg)]'>
          Start building with Silgi
        </h2>
        <p className='text-[var(--k-text)] max-w-sm mb-10 font-normal leading-relaxed'>
          Prepare for a development environment that can finally keep pace with the speed of your mind.
        </p>
        <Link to='/docs/$' params={{ _splat: '' }} className='k-btn k-btn--primary'>
          Get Started
        </Link>
      </W>
    </section>
  )
}

/* ═══ SHARED ════════════════════════════════════════ */

function W({
  children,
  className = '',
  ticks,
  border,
}: {
  children: React.ReactNode
  className?: string
  ticks?: boolean
  border?: boolean
}) {
  const cls = ticks ? 'k-ticks' : border ? 'k-border' : ''
  return <div className={`${cls} ${className}`}>{children}</div>
}

function Cell({ children, bl, bt }: { children: React.ReactNode; bl?: boolean; bt?: boolean }) {
  return (
    <div
      className={`p-6 sm:p-10 ${bl ? 'border-l border-[var(--k-line)]' : ''} ${bt ? 'border-t border-[var(--k-line)]' : ''}`}
    >
      {children}
    </div>
  )
}

function CT({ t, d }: { t: string; d: string }) {
  return (
    <div className='flex flex-col gap-2'>
      <h5 className='font-medium text-[var(--k-fg)]'>{t}</h5>
      <p className='text-sm text-[var(--k-dim)] font-normal leading-relaxed max-w-[28rem] text-pretty'>{d}</p>
    </div>
  )
}

function Badge({ c, t, b }: { c: string; t: string; b: string }) {
  return (
    <div className='flex items-center gap-2.5'>
      <span className='w-[6px] h-[6px] rounded-full' style={{ backgroundColor: c }} />
      <h5 className='font-medium text-[var(--k-fg)]'>{t}</h5>
      <span className='k-mono text-[11px] uppercase tracking-[.15em] ml-auto' style={{ color: c }}>
        {b}
      </span>
    </div>
  )
}
