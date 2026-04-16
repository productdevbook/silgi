/**
 * Typed surface for the request pipeline context.
 *
 * @category Context
 */

import type { RequestTrace } from '../plugins/analytics.ts'

/**
 * Fields that Silgi internals may place on every request's `ctx`.
 *
 * @remarks
 * All fields are optional — they appear only when the relevant framework
 * feature is active (e.g. `trace` only when analytics is enabled;
 * `params` only when the matched route has URL parameters). Users extend
 * their own context via the `context` factory passed to `silgi()`.
 *
 * At runtime the pipeline still treats `ctx` as a loose
 * `Record<string, unknown>`; this interface exists so contributors and
 * TypeScript users can see which keys are framework-reserved without
 * grepping the codebase.
 *
 * @category Context
 */
export interface BaseContext {
  /** URL path parameters from the matched route, when present. */
  params?: Record<string, string>
  /** Per-request analytics trace, attached by the analytics plugin. */
  trace?: RequestTrace
}
