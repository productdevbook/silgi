/**
 * defineRouteKit — factory helper for isolated-package route builders.
 *
 * @remarks
 * In monorepos where domain packages (commerce, PIM, MES…) do not own a
 * Silgi instance, routes are written as factories that accept the
 * instance and the guards via dependency injection at the server wiring
 * point. Without a kit, every factory has to fall back to `any` for
 * both the guard refs and the resolver `ctx`, because the concrete
 * guard types aren't known inside the package.
 *
 * `defineRouteKit<Ctx>()` fixes the ctx shape at the kit level and
 * lets the package declare the guard return types it depends on. The
 * resolver then receives a ctx correctly enriched with every declared
 * guard's return — no `as any`, no manual intersection.
 *
 * @example
 * ```ts
 * // package/src/kit.ts
 * import { defineRouteKit } from 'silgi'
 * export const kit = defineRouteKit<MyCtx>()
 *
 * // package/src/routes/posts.api.ts
 * export const createPost = kit.route<{
 *   auth: { user: { id: number } }
 *   org: { orgId: string }
 * }>()(({ s, auth, org }) =>
 *   s.$route({ method: 'POST', path: '/posts' })
 *     .$use(auth)
 *     .$use(org)
 *     .$input(z.object({ title: z.string() }))
 *     .$resolve(({ input, ctx }) => {
 *       ctx.user.id    // ✓ typed
 *       ctx.orgId      // ✓ typed
 *     }),
 * )
 *
 * // server/src/index.ts
 * import { createPost } from 'package/routes/posts.api.ts'
 * const k = silgi({ context: (req) => buildMyCtx(req) })
 * const authGuard = k.guard(...)
 * const orgGuard  = k.guard(...)
 *
 * const posts = {
 *   create: createPost({ s: k, auth: authGuard, org: orgGuard }),
 * }
 * ```
 */

import type { SilgiInstance } from './silgi.ts'
import type { ErrorDef, GuardDef } from './types.ts'

/**
 * Shape of a `guards` map passed to a kit route. Each entry declares the
 * context additions that specific guard contributes.
 */
export type GuardMap = Record<string, Record<string, unknown> | void>

/** Convert a `GuardMap` into the deps object shape passed to kit builders. */
export type GuardDeps<TGuards extends GuardMap> = {
  [K in keyof TGuards]: GuardDef<any, TGuards[K], ErrorDef>
}

/** Deps injected into a kit route builder — the instance plus the typed guards. */
export type RouteKitDeps<TCtx extends Record<string, unknown>, TGuards extends GuardMap> = {
  s: SilgiInstance<TCtx>
} & GuardDeps<TGuards>

/**
 * Return value of `defineRouteKit<Ctx>()`.
 *
 * @remarks
 * Use {@link RouteKit.route} to declare a single route that depends on a
 * named set of guards. The kit carries no runtime state — it only
 * binds the ctx shape for inference.
 */
export interface RouteKit<TCtx extends Record<string, unknown>> {
  /**
   * Declare a route factory.
   *
   * @typeParam TGuards - Map of guard name → context additions. Empty by
   *   default; pass an explicit shape when the route depends on guards.
   *
   * @example
   * ```ts
   * kit.route<{ auth: { user: User } }>()(({ s, auth }) =>
   *   s.$use(auth).$resolve(({ ctx }) => ctx.user)
   * )
   * ```
   */
  route: <TGuards extends GuardMap = {}>() => <TReturn>(
    builder: (deps: RouteKitDeps<TCtx, TGuards>) => TReturn,
  ) => (deps: RouteKitDeps<TCtx, TGuards>) => TReturn
}

/**
 * Create a context-bound route kit for isolated packages.
 *
 * @typeParam TCtx - Base context shape the server will provide. Flows
 *   into every route's resolver through the injected `s` instance.
 */
export function defineRouteKit<TCtx extends Record<string, unknown>>(): RouteKit<TCtx> {
  return {
    route:
      <_TGuards extends GuardMap = {}>() =>
      <TReturn>(builder: (deps: RouteKitDeps<TCtx, _TGuards>) => TReturn) =>
        builder,
  }
}
