/**
 * Shared WeakMap for passing analytics traces between handler and analytics plugin.
 *
 * Lives in core/ so the dependency direction is correct:
 *   core/handler.ts → core/trace-map.ts ← plugins/analytics.ts
 *
 * The WeakMap maps Request → RequestTrace, allowing the handler to inject
 * trace data into context without importing the analytics plugin.
 */

// Using `unknown` so core/ doesn't depend on analytics types.
// The actual value is a RequestTrace instance, set by wrapWithAnalytics.
export const analyticsTraceMap = new WeakMap<Request, unknown>()
