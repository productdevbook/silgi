/**
 * Persistent analytics storage — flush/hydrate to unstorage.
 */

import { useStorage } from '../../core/storage.ts'

import { normalizeErrorEntries, normalizeRequestEntries } from './normalize.ts'
import { isTrackedRequestPath } from './utils.ts'

import type { ErrorEntry, RequestEntry } from './types.ts'

export class AnalyticsStore {
  #storage: ReturnType<typeof useStorage>
  #pendingRequests: RequestEntry[] = []
  #pendingErrors: ErrorEntry[] = []
  #retentionMs: number
  #timer: ReturnType<typeof setInterval> | null = null
  #flushing = false

  constructor(flushInterval: number, retentionDays: number) {
    this.#storage = useStorage('data')
    this.#retentionMs = retentionDays * 86_400_000
    this.#timer = setInterval(() => this.flush(), flushInterval)
    if (typeof this.#timer === 'object' && 'unref' in this.#timer) this.#timer.unref()
  }

  enqueueRequest(entry: RequestEntry): void {
    this.#pendingRequests.push(entry)
  }

  enqueueError(entry: ErrorEntry): void {
    this.#pendingErrors.push(entry)
  }

  async flush(): Promise<void> {
    if (this.#flushing) return
    const requests = this.#pendingRequests.splice(0)
    const errors = this.#pendingErrors.splice(0)
    if (requests.length === 0 && errors.length === 0) return

    this.#flushing = true
    try {
      const cutoff = Date.now() - this.#retentionMs
      if (requests.length > 0) {
        const existing = normalizeRequestEntries(await this.#storage.getItem('analytics:requests')).filter((entry) =>
          isTrackedRequestPath(entry.path),
        )
        const merged = [...existing, ...requests].filter((e) => e.timestamp >= cutoff)
        await this.#storage.setItem('analytics:requests', merged)
      }
      if (errors.length > 0) {
        const existing = normalizeErrorEntries(await this.#storage.getItem('analytics:errors')).filter((entry) =>
          isTrackedRequestPath(entry.procedure),
        )
        const merged = [...existing, ...errors].filter((e) => e.timestamp >= cutoff)
        await this.#storage.setItem('analytics:errors', merged)
      }
    } catch {
      // Storage failure — re-enqueue items so they're not lost
      this.#pendingRequests.unshift(...requests)
      this.#pendingErrors.unshift(...errors)
    } finally {
      this.#flushing = false
    }
  }

  async getRequests(): Promise<RequestEntry[]> {
    const cutoff = Date.now() - this.#retentionMs
    const stored = normalizeRequestEntries(await this.#storage.getItem('analytics:requests')).filter(
      (entry) => isTrackedRequestPath(entry.path) && entry.timestamp >= cutoff,
    )
    const pending = this.#pendingRequests.filter(
      (entry) => isTrackedRequestPath(entry.path) && entry.timestamp >= cutoff,
    )
    if (pending.length === 0) return stored
    return [...stored, ...pending]
  }

  async getErrors(): Promise<ErrorEntry[]> {
    const cutoff = Date.now() - this.#retentionMs
    const stored = normalizeErrorEntries(await this.#storage.getItem('analytics:errors')).filter(
      (entry) => isTrackedRequestPath(entry.procedure) && entry.timestamp >= cutoff,
    )
    const pending = this.#pendingErrors.filter(
      (entry) => isTrackedRequestPath(entry.procedure) && entry.timestamp >= cutoff,
    )
    if (pending.length === 0) return stored
    return [...stored, ...pending]
  }

  async hydrate(): Promise<{ totalRequests: number; totalErrors: number }> {
    try {
      const counters = await this.#storage.getItem<{ totalRequests: number; totalErrors: number }>('analytics:counters')
      return counters ?? { totalRequests: 0, totalErrors: 0 }
    } catch {
      return { totalRequests: 0, totalErrors: 0 }
    }
  }

  async saveCounters(totalRequests: number, totalErrors: number): Promise<void> {
    try {
      await this.#storage.setItem('analytics:counters', { totalRequests, totalErrors })
    } catch {
      // Best-effort
    }
  }

  async loadHiddenPaths(): Promise<string[]> {
    try {
      const paths = await this.#storage.getItem<string[]>('analytics:hiddenPaths')
      return Array.isArray(paths) ? paths : []
    } catch {
      return []
    }
  }

  saveHiddenPaths(paths: string[]): void {
    this.#storage.setItem('analytics:hiddenPaths', paths).catch(() => {})
  }

  async dispose(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer)
    this.#timer = null
    await this.flush()
  }
}
