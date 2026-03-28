import { appRouter } from '$lib/server/rpc'
import { createHandler } from 'silgi/sveltekit'

const handler = createHandler(appRouter, {
  prefix: '/api/rpc',
  context: () => ({ db: 'sveltekit-db' }),
})

export const GET = handler
export const POST = handler
