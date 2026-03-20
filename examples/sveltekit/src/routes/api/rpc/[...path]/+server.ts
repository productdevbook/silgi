import { appRouter } from '$lib/server/rpc'
import { silgiSvelteKit } from 'silgi/sveltekit'

const handler = silgiSvelteKit(appRouter, {
  prefix: '/api/rpc',
  context: () => ({ db: 'sveltekit-db' }),
})

export const GET = handler
export const POST = handler
