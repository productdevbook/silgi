# Katman React Client

A React client app that connects to any Katman server using `createClient`, `createLink` (ofetch), and `@tanstack/react-query` integration via `createQueryUtils`.

Start a Katman server first (e.g. the `standalone` or `hono` example on port 3000), then run this client.

## Quick Start

```bash
npx giget@latest gh:productdevbook/katman/examples/client-react my-client-react-app
cd my-client-react-app
pnpm install
pnpm dev
```

## What it demonstrates

- `createClient` + `createLink` from `katman/client/ofetch` for type-safe RPC calls
- `createQueryUtils` from `katman/tanstack-query` for `useQuery` / `useMutation` integration
- Vite dev server with proxy to the Katman backend
