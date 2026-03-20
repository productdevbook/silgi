import { silgiH3 } from 'silgi/h3'

import { appRouter, db } from '../../rpc'

export default silgiH3(appRouter, {
  context: (event) => ({
    db,
    token: event.req.headers.get('authorization')?.replace('Bearer ', ''),
  }),
})
