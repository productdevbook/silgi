import type { router } from './router'
import { createTRPCClient, httpBatchLink } from '@trpc/client'

export const client = createTRPCClient<typeof router>({
  links: [
    httpBatchLink({
      url: 'http://localhost:3000/trpc',
    }),
  ],
})
