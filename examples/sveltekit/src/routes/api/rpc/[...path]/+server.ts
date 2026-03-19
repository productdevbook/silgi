import { appRouter } from '$lib/server/rpc'
import { katmanSvelteKit } from 'katman/sveltekit'

const handler = katmanSvelteKit(appRouter, {
  prefix: '/api/rpc',
  context: () => ({ db: 'sveltekit-db' }),
})

export const GET = handler
export const POST = handler
