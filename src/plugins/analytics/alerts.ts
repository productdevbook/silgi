/**
 * Analytics Alerts — configurable alerting with sliding window evaluation.
 */

// ── Types ──

export interface AlertRule {
  /** Unique name for this alert. */
  name: string
  /** Condition to evaluate. */
  condition: 'error_rate' | 'latency_p95' | 'latency_avg' | 'error_count' | 'request_count' | 'no_requests'
  /** Threshold value. For rates: percentage (0-100). For latency: milliseconds. For counts: absolute number. */
  threshold: number
  /** Evaluation window in seconds (default: 300 = 5 minutes). */
  windowSeconds?: number
  /** Cooldown between repeated alerts in seconds (default: 3600 = 1 hour). */
  cooldownSeconds?: number
  /** Optional: only evaluate for a specific procedure. */
  procedure?: string
  /** Actions to execute when alert fires. */
  actions: AlertAction[]
}

export type AlertAction =
  | { type: 'webhook'; url: string; headers?: Record<string, string> }
  | { type: 'slack'; webhookUrl: string; channel?: string }
  | { type: 'console' }

export interface AlertEvent {
  rule: string
  condition: string
  value: number
  threshold: number
  procedure?: string
  timestamp: number
  message: string
}

export interface AlertState {
  lastFired: number
  lastValue: number
}

// ── Window Data ──

interface WindowSample {
  timestamp: number
  durationMs: number
  isError: boolean
  procedure: string
}

// ── Alert Engine ──

export class AlertEngine {
  #rules: AlertRule[]
  #state = new Map<string, AlertState>()
  #samples: WindowSample[] = []
  #maxWindowMs: number
  #timer: ReturnType<typeof setInterval> | null = null
  #history: AlertEvent[] = []

  constructor(rules: AlertRule[]) {
    this.#rules = rules
    this.#maxWindowMs = Math.max(...rules.map((r) => (r.windowSeconds ?? 300) * 1000), 300_000)

    // Evaluate every 30 seconds
    this.#timer = setInterval(() => this.evaluate(), 30_000)
    if (typeof this.#timer === 'object' && 'unref' in this.#timer) this.#timer.unref()
  }

  /** Record a sample for window evaluation. */
  record(durationMs: number, isError: boolean, procedure: string): void {
    const now = Date.now()
    this.#samples.push({ timestamp: now, durationMs, isError, procedure })

    // Prune old samples
    const cutoff = now - this.#maxWindowMs
    while (this.#samples.length > 0 && this.#samples[0]!.timestamp < cutoff) {
      this.#samples.shift()
    }
  }

  /** Evaluate all rules against current window data. */
  evaluate(): void {
    const now = Date.now()

    for (const rule of this.#rules) {
      const windowMs = (rule.windowSeconds ?? 300) * 1000
      const cooldownMs = (rule.cooldownSeconds ?? 3600) * 1000
      const cutoff = now - windowMs

      // Check cooldown
      const state = this.#state.get(rule.name)
      if (state && now - state.lastFired < cooldownMs) continue

      // Get samples in window
      let samples = this.#samples.filter((s) => s.timestamp >= cutoff)
      if (rule.procedure) {
        samples = samples.filter((s) => s.procedure.includes(rule.procedure!))
      }

      const value = this.#computeValue(rule.condition, samples)
      if (value === null) continue

      const fired = this.#checkThreshold(rule.condition, value, rule.threshold)
      if (!fired) continue

      // Fire alert
      const event: AlertEvent = {
        rule: rule.name,
        condition: rule.condition,
        value,
        threshold: rule.threshold,
        procedure: rule.procedure,
        timestamp: now,
        message: `Alert "${rule.name}": ${rule.condition} is ${formatValue(rule.condition, value)} (threshold: ${formatValue(rule.condition, rule.threshold)})`,
      }

      this.#state.set(rule.name, { lastFired: now, lastValue: value })
      this.#history.push(event)
      if (this.#history.length > 1000) this.#history.shift()

      // Execute actions
      for (const action of rule.actions) {
        void this.#executeAction(action, event)
      }
    }
  }

  #computeValue(condition: AlertRule['condition'], samples: WindowSample[]): number | null {
    if (samples.length === 0) {
      return condition === 'no_requests' ? 0 : null
    }

    switch (condition) {
      case 'error_rate':
        return (samples.filter((s) => s.isError).length / samples.length) * 100
      case 'error_count':
        return samples.filter((s) => s.isError).length
      case 'request_count':
        return samples.length
      case 'no_requests':
        return samples.length
      case 'latency_avg':
        return samples.reduce((sum, s) => sum + s.durationMs, 0) / samples.length
      case 'latency_p95': {
        const sorted = samples.map((s) => s.durationMs).sort((a, b) => a - b)
        const idx = Math.ceil(sorted.length * 0.95) - 1
        return sorted[Math.max(0, idx)]!
      }
    }
  }

  #checkThreshold(condition: AlertRule['condition'], value: number, threshold: number): boolean {
    // no_requests fires when value <= threshold (e.g., 0 requests)
    if (condition === 'no_requests') return value <= threshold
    // Everything else fires when value >= threshold
    return value >= threshold
  }

  async #executeAction(action: AlertAction, event: AlertEvent): Promise<void> {
    try {
      switch (action.type) {
        case 'console':
          console.warn(`[silgi:alert] ${event.message}`)
          break

        case 'webhook':
          await fetch(action.url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...action.headers },
            body: JSON.stringify(event),
          })
          break

        case 'slack':
          await fetch(action.webhookUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              channel: action.channel,
              text: event.message,
              blocks: [
                {
                  type: 'section',
                  text: {
                    type: 'mrkdwn',
                    text: `🚨 *${event.rule}*\n${event.message}`,
                  },
                },
              ],
            }),
          })
          break
      }
    } catch (err) {
      console.error(
        `[silgi:alert] Failed to execute ${action.type} action: ${err instanceof Error ? err.message : err}`,
      )
    }
  }

  /** Get alert history. */
  getHistory(): AlertEvent[] {
    return this.#history
  }

  /** Get current alert states. */
  getStates(): Record<string, AlertState> {
    const result: Record<string, AlertState> = {}
    for (const [name, state] of this.#state) {
      result[name] = state
    }
    return result
  }

  dispose(): void {
    if (this.#timer) clearInterval(this.#timer)
    this.#timer = null
  }
}

// ── Helpers ──

function formatValue(condition: AlertRule['condition'], value: number): string {
  switch (condition) {
    case 'error_rate':
      return `${value.toFixed(1)}%`
    case 'latency_avg':
    case 'latency_p95':
      return `${value.toFixed(1)}ms`
    default:
      return String(value)
  }
}
