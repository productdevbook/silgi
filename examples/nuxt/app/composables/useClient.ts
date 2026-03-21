import { createClient } from 'silgi/client'
import { createLink } from 'silgi/client/ofetch'

import type { AppRouter } from '../../server/rpc/router'

export function useClient(options?: { binary?: boolean; devalue?: boolean }) {
  const link = createLink({
    url: '',
    binary: options?.binary,
    devalue: options?.devalue,
  })
  return createClient<AppRouter>(link)
}
