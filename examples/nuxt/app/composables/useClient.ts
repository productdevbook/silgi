import { createClient } from 'silgi/client'
import { createLink } from 'silgi/client/ofetch'

import type { InferClient } from 'silgi'
import type { AppRouter } from '../../server/rpc/router'

type Client = InferClient<AppRouter>

export function useClient(options?: { binary?: boolean; devalue?: boolean }) {
  const link = createLink({
    url: '',
    binary: options?.binary,
    devalue: options?.devalue,
  })
  return createClient<Client>(link)
}
