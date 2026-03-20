import { silgiNitro } from 'silgi/nitro'

import { appRouter } from '../../rpc'

export default silgiNitro(appRouter, {
  context: () => ({ db: 'nuxt-db' }),
})
