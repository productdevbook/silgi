import { createTRPCClient, httpBatchLink } from '@trpc/client'

import type { router } from './router'

export const client = createTRPCClient<typeof router>({
  links: [
    httpBatchLink({
      url: 'http://localhost:3000/trpc',
    }),
  ],
})
