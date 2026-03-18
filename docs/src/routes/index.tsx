import { createFileRoute, Link } from '@tanstack/react-router';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '@/lib/layout.shared';

export const Route = createFileRoute('/')({
  component: Home,
});

function Home() {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-16 text-center">
        <div className="mb-4 inline-flex items-center rounded-full border px-3 py-1 text-sm text-fd-muted-foreground">
          5.7x faster than oRPC &middot; 18x faster than H3
        </div>
        <h1 className="mb-4 text-4xl font-bold tracking-tight md:text-5xl">
          The fastest type-safe
          <br />
          <span className="text-fd-primary">RPC framework</span>
        </h1>
        <p className="mb-8 max-w-lg text-fd-muted-foreground">
          End-to-end type safety. Compiled pipeline. Single package.
          JSON, MessagePack, WebSocket. Node.js, Bun, Deno.
        </p>
        <div className="flex gap-3">
          <Link
            to="/docs/$"
            params={{ _splat: '' }}
            className="rounded-lg bg-fd-primary px-5 py-2.5 text-sm font-medium text-fd-primary-foreground"
          >
            Get Started
          </Link>
          <a
            href="https://github.com/productdevbook/katman"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border px-5 py-2.5 text-sm font-medium"
          >
            GitHub
          </a>
        </div>

        <div className="mt-16 grid max-w-3xl gap-6 sm:grid-cols-3">
          <div className="rounded-xl border p-6 text-left">
            <p className="mb-1 text-2xl font-bold text-fd-primary">111 ns</p>
            <p className="text-sm text-fd-muted-foreground">Pipeline execution — no middleware</p>
          </div>
          <div className="rounded-xl border p-6 text-left">
            <p className="mb-1 text-2xl font-bold text-fd-primary">78 µs</p>
            <p className="text-sm text-fd-muted-foreground">HTTP latency — guard + Zod validation</p>
          </div>
          <div className="rounded-xl border p-6 text-left">
            <p className="mb-1 text-2xl font-bold text-fd-primary">2 µs</p>
            <p className="text-sm text-fd-muted-foreground">Bun handler — per request</p>
          </div>
        </div>
      </main>
    </HomeLayout>
  );
}
