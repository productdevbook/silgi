import { katmanNextjs } from 'katman/nextjs'

import { appRouter } from '../../../../server/rpc'

const handler = katmanNextjs(appRouter, {
  prefix: '/api/rpc',
  context: () => ({ db: 'nextjs-db' }),
})

export { handler as GET, handler as POST }
