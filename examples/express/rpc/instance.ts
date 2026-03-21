import { silgi } from 'silgi'

import { todos } from './todos/schema'

export const s = silgi({
  context: () => ({ todos }),
})
