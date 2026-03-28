import { createClient } from 'silgi/client'
import { createLink } from 'silgi/client/adapters/ofetch'

import type { router } from './router'

const link = createLink({ url: 'http://localhost:3000' })
export const client = createClient<typeof router>(link)
