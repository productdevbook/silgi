import { createGeneralUtils } from './general-utils.ts'
import { createProcedureUtils } from './procedure-utils.ts'

import type { Client, ClientContext, NestedClient } from '../../client/types.ts'
import type { GeneralUtils } from './general-utils.ts'
import type { ProcedureUtils } from './procedure-utils.ts'

export type RouterUtils<T extends NestedClient> =
  T extends Client<infer UClientContext, infer UInput, infer UOutput, infer UError>
    ? ProcedureUtils<UClientContext, UInput, UOutput, UError> & GeneralUtils<UInput>
    : {
        [K in keyof T]: T[K] extends NestedClient ? RouterUtils<T[K]> : never
      } & GeneralUtils<unknown>

export interface CreateRouterUtilsOptions {
  path?: string[]
}

/**
 * Create Pinia Colada utilities from a Silgi client.
 *
 * Both client-side and server-side clients are supported.
 */
export function createRouterUtils<T extends NestedClient>(
  client: T,
  options: CreateRouterUtilsOptions = {},
): RouterUtils<T> {
  const path = options.path ?? []

  const generalUtils = createGeneralUtils(path)
  const procedureUtils = createProcedureUtils(client as any, { path })

  const recursive = new Proxy(
    {
      ...generalUtils,
      ...procedureUtils,
    },
    {
      get(target, prop) {
        const value = Reflect.get(target, prop)

        if (typeof prop !== 'string') {
          return value
        }

        const nextUtils = createRouterUtils((client as any)[prop], { ...options, path: [...path, prop] })

        if (typeof value !== 'function') {
          return nextUtils
        }

        return new Proxy(value, {
          get(_, prop) {
            return Reflect.get(nextUtils, prop)
          },
        })
      },
    },
  )

  return recursive as any
}
