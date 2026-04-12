import { createHandler } from 'silgi/nextjs'

import { appRouter } from '../../../../server/rpc'

const handler = createHandler(appRouter, {
  prefix: '/api/rpc',
  context: () => ({ db: 'nextjs-db' }),
})

export { handler as GET, handler as POST }
