/**
 * Analytics API base path — derived from the dashboard's current URL.
 *
 * The dashboard HTML is served at whatever path the Silgi adapter mounts it
 * (e.g. `/api/analytics`, `/api/rpc/api/analytics`, or a custom mount).
 * All dashboard fetches must be relative to that mount so the bundle works
 * regardless of where it's deployed.
 */

export function getAnalyticsBase(): string {
  if (typeof window === 'undefined') return '/api/analytics'
  return window.location.pathname.replace(/\/$/, '')
}
