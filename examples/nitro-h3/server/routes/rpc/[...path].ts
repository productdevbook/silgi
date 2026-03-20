import { silgiNitro } from 'silgi/nitro'

import { appRouter, db } from '../../rpc'

export default silgiNitro(appRouter, {
  context: (event) => ({
    db,
    token: event.req.headers.get('authorization')?.replace('Bearer ', ''),
  }),
})
