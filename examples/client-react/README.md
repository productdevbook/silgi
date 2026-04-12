# Silgi React Client

A React client app that connects to any Silgi server using `createClient`, `createLink` (ofetch), and `@tanstack/react-query` integration via `createQueryUtils`.

Start a Silgi server first (e.g. the `standalone` or `express` example on port 3000), then run this client.

## Quick Start

```bash
npx giget@latest gh:productdevbook/silgi/examples/client-react my-client-react-app
cd my-client-react-app
pnpm install
pnpm dev
```

## What it demonstrates

- `createClient` + `createLink` from `silgi/client/ofetch` for type-safe RPC calls
- `createQueryUtils` from `silgi/tanstack-query` for `useQuery` / `useMutation` integration
- Vite dev server with proxy to the Silgi backend
