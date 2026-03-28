/**
 * Type inference benchmark — measures instantiation cost per expression.
 *
 * Uses @ark/attest to deterministically count type instantiations
 * for Pinia Colada and TanStack Query integrations.
 *
 * Run: npx tsx bench/types.ts
 */

import { bench } from '@ark/attest'

import type { Client } from '../src/client/types.ts'
import type { SilgiError } from '../src/core/error.ts'

// ── Mock Client Types (simulating InferClient output) ──────

// Small router: 5 procedures
type SmallClient = {
  health: Client<{}, undefined, { status: 'ok'; uptime: number }, SilgiError>
  users: {
    list: Client<{}, { limit?: number }, { id: number; name: string }[], SilgiError>
    get: Client<{}, { id: number }, { id: number; name: string; email: string }, SilgiError>
    create: Client<{}, { name: string; email: string }, { id: number; name: string; email: string }, SilgiError>
    delete: Client<{}, { id: number }, { success: boolean }, SilgiError>
  }
}

// Medium router: ~20 procedures across nested namespaces
type MediumClient = {
  health: Client<{}, undefined, { status: 'ok' }, SilgiError>
  users: {
    list: Client<{}, { limit?: number; offset?: number }, { id: number; name: string }[], SilgiError>
    get: Client<{}, { id: number }, { id: number; name: string; email: string; role: string }, SilgiError>
    create: Client<{}, { name: string; email: string }, { id: number; name: string }, SilgiError>
    update: Client<{}, { id: number; name?: string; email?: string }, { id: number; name: string }, SilgiError>
    delete: Client<{}, { id: number }, { success: boolean }, SilgiError>
  }
  posts: {
    list: Client<{}, { authorId?: number; limit?: number }, { id: number; title: string }[], SilgiError>
    get: Client<{}, { id: number }, { id: number; title: string; body: string; authorId: number }, SilgiError>
    create: Client<{}, { title: string; body: string }, { id: number; title: string }, SilgiError>
    update: Client<{}, { id: number; title?: string; body?: string }, { id: number; title: string }, SilgiError>
    delete: Client<{}, { id: number }, { success: boolean }, SilgiError>
    comments: {
      list: Client<{}, { postId: number }, { id: number; text: string }[], SilgiError>
      create: Client<{}, { postId: number; text: string }, { id: number; text: string }, SilgiError>
      delete: Client<{}, { id: number }, { success: boolean }, SilgiError>
    }
  }
  admin: {
    stats: Client<{}, undefined, { totalUsers: number; totalPosts: number }, SilgiError>
    settings: {
      get: Client<{}, undefined, Record<string, string>, SilgiError>
      update: Client<{}, Record<string, string>, Record<string, string>, SilgiError>
    }
    logs: Client<{}, { since?: string; level?: string }, { entries: { ts: string; msg: string }[] }, SilgiError>
  }
  auth: {
    login: Client<{}, { email: string; password: string }, { token: string }, SilgiError>
    logout: Client<{}, undefined, { success: boolean }, SilgiError>
    me: Client<{}, undefined, { id: number; name: string; email: string; role: string }, SilgiError>
  }
}

// ── Pinia Colada Benchmarks ────────────────────────────────

import type { RouterUtils } from '../src/integrations/pinia-colada/router-utils.ts'
import type { ProcedureUtils } from '../src/integrations/pinia-colada/procedure-utils.ts'
import type { QueryOptionsIn, MutationOptionsIn } from '../src/integrations/pinia-colada/types.ts'

// Baseline: cost of importing pinia-colada types
bench.baseline(() => {
  return {} as RouterUtils<SmallClient>
})

// Pinia Colada: RouterUtils with small client
bench('colada: RouterUtils<SmallClient>', () => {
  return {} as RouterUtils<SmallClient>
}).types([0,"instantiations"])

// Pinia Colada: RouterUtils with medium client
bench('colada: RouterUtils<MediumClient>', () => {
  return {} as RouterUtils<MediumClient>
}).types([21,"instantiations"])

// Pinia Colada: ProcedureUtils inference
bench('colada: ProcedureUtils leaf', () => {
  return {} as ProcedureUtils<{}, { id: number }, { id: number; name: string; email: string }, SilgiError>
}).types([0,"instantiations"])

// Pinia Colada: QueryOptionsIn conditional type
bench('colada: QueryOptionsIn (with input)', () => {
  return {} as QueryOptionsIn<{}, { id: number }, { name: string }, SilgiError, undefined>
}).types([37,"instantiations"])

// Pinia Colada: QueryOptionsIn no-input (optional)
bench('colada: QueryOptionsIn (no input)', () => {
  return {} as QueryOptionsIn<{}, undefined, { status: string }, SilgiError, undefined>
}).types([36,"instantiations"])

// Pinia Colada: MutationOptionsIn
bench('colada: MutationOptionsIn', () => {
  return {} as MutationOptionsIn<{}, { name: string }, { id: number }, SilgiError, Record<any, any>>
}).types([38,"instantiations"])

// Pinia Colada: Deep nested access type
bench('colada: deep nested type', () => {
  type R = RouterUtils<MediumClient>
  return {} as R['posts']['comments']
}).types([118,"instantiations"])

// ── TanStack Query Benchmarks ──────────────────────────────

import type { QueryUtils, ProcedureQueryUtils } from '../src/integrations/tanstack-query/index.ts'

// TanStack: QueryUtils with small client
bench('tanstack: QueryUtils<SmallClient>', () => {
  return {} as QueryUtils<SmallClient>
}).types([52,"instantiations"])

// TanStack: QueryUtils with medium client
bench('tanstack: QueryUtils<MediumClient>', () => {
  return {} as QueryUtils<MediumClient>
}).types([52,"instantiations"])

// TanStack: ProcedureQueryUtils leaf
bench('tanstack: ProcedureQueryUtils leaf', () => {
  return {} as ProcedureQueryUtils<{ id: number }, { id: number; name: string; email: string }, SilgiError>
}).types([0,"instantiations"])

// TanStack: Deep nested access type
bench('tanstack: deep nested type', () => {
  type R = QueryUtils<MediumClient>
  return {} as R['posts']['comments']
}).types([125,"instantiations"])

// ── InferClient Benchmark ──────────────────────────────────

import type { InferClient } from '../src/types.ts'
import type { ProcedureDef } from '../src/types.ts'

// InferClient: small router
bench('core: InferClient small', () => {
  type Router = {
    health: ProcedureDef<'query', undefined, { status: 'ok' }>
    users: {
      list: ProcedureDef<'query', { limit?: number }, { id: number; name: string }[]>
      get: ProcedureDef<'query', { id: number }, { id: number; name: string }>
      create: ProcedureDef<'mutation', { name: string }, { id: number }>
    }
  }
  return {} as InferClient<Router>
}).types([33,"instantiations"])

// InferClient: medium router
bench('core: InferClient medium', () => {
  type Router = {
    health: ProcedureDef<'query', undefined, { status: 'ok' }>
    users: {
      list: ProcedureDef<'query', { limit?: number }, { id: number; name: string }[]>
      get: ProcedureDef<'query', { id: number }, { id: number; name: string }>
      create: ProcedureDef<'mutation', { name: string }, { id: number }>
      update: ProcedureDef<'mutation', { id: number; name?: string }, { id: number }>
      delete: ProcedureDef<'mutation', { id: number }, { success: boolean }>
    }
    posts: {
      list: ProcedureDef<'query', { authorId?: number }, { id: number; title: string }[]>
      get: ProcedureDef<'query', { id: number }, { id: number; title: string; body: string }>
      create: ProcedureDef<'mutation', { title: string; body: string }, { id: number }>
      comments: {
        list: ProcedureDef<'query', { postId: number }, { id: number; text: string }[]>
        create: ProcedureDef<'mutation', { postId: number; text: string }, { id: number }>
      }
    }
    admin: {
      stats: ProcedureDef<'query', undefined, { total: number }>
      settings: {
        get: ProcedureDef<'query', undefined, Record<string, string>>
        update: ProcedureDef<'mutation', Record<string, string>, Record<string, string>>
      }
    }
    auth: {
      login: ProcedureDef<'mutation', { email: string; password: string }, { token: string }>
      logout: ProcedureDef<'mutation', undefined, { success: boolean }>
      me: ProcedureDef<'query', undefined, { id: number; name: string }>
    }
  }
  return {} as InferClient<Router>
}).types([33,"instantiations"])
