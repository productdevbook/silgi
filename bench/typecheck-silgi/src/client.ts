import type { InferClient } from 'silgi'
import type { router } from './router'
import { createClient } from '../../src/client/client.ts'
import { createLink } from '../../src/client/adapters/ofetch/index.ts'

type AppRouter = typeof router
type Client = InferClient<AppRouter>

const link = createLink({ url: 'http://localhost:3000' })
export const client = createClient<Client>(link)
