/**
 * Client-side CSRF Protection — auto-injects the CSRF header.
 *
 * Pairs with the server's CSRFPlugin to ensure requests
 * originated from JavaScript, not cross-origin form submissions.
 */

import type { ClientLink, ClientContext, ClientOptions } from '../types.ts'

export interface CSRFLinkOptions {
  headerName?: string
  headerValue?: string
}

/**
 * Wrap a link to automatically inject the CSRF header on every request.
 */
export function withCSRF<TClientContext extends ClientContext>(
  link: ClientLink<TClientContext>,
  options: CSRFLinkOptions = {},
): ClientLink<TClientContext> {
  const headerName = options.headerName ?? 'x-csrf-token'
  const headerValue = options.headerValue ?? 'silgi'

  return {
    call(path, input, callOptions) {
      const enhancedOptions = {
        ...callOptions,
        headers: {
          ...(callOptions as any).headers,
          [headerName]: headerValue,
        },
      } as unknown as ClientOptions<TClientContext>

      return link.call(path, input, enhancedOptions)
    },
  }
}
