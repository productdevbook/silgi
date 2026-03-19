import { katmanNitro } from 'katman/nitro'

import { appRouter } from '../../rpc'

export default katmanNitro(appRouter, {
  context: () => ({ db: 'nuxt-db' }),
})
