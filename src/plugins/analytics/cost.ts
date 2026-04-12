/**
 * Analytics Cost Tracking — span cost metadata and budget monitoring.
 */

// ── Types ──

export interface SpanCost {
  /** Number of tokens/units consumed. */
  units?: number
  /** Cost in dollars. */
  amount: number
  /** Cost currency (default: USD). */
  currency?: string
  /** Provider name (e.g., 'openai', 'anthropic', 'aws'). */
  provider?: string
}

export interface CostBucket {
  time: number
  totalAmount: number
  byProvider: Record<string, number>
  byProcedure: Record<string, number>
  byKind: Record<string, number>
}

export interface CostSummary {
  totalAmount: number
  todayAmount: number
  byProvider: Record<string, number>
  byProcedure: Record<string, number>
  byKind: Record<string, number>
  dailyBuckets: CostBucket[]
}

export interface BudgetRule {
  /** Unique name. */
  name: string
  /** Budget limit in dollars. */
  limit: number
  /** Period: 'daily' | 'weekly' | 'monthly'. */
  period: 'daily' | 'weekly' | 'monthly'
  /** Optional: scope to a specific provider. */
  provider?: string
  /** Optional: scope to a specific procedure. */
  procedure?: string
}

// ── Constants ──

const DAY_MS = 86_400_000
const MAX_DAILY_BUCKETS = 30

// ── Cost Tracker ──

export class CostTracker {
  #dailyBuckets: CostBucket[] = []
  #currentDay: CostBucket | null = null
  #budgetRules: BudgetRule[]
  #onBudgetExceeded?: (rule: BudgetRule, current: number) => void

  constructor(budgetRules: BudgetRule[] = [], onBudgetExceeded?: (rule: BudgetRule, current: number) => void) {
    this.#budgetRules = budgetRules
    this.#onBudgetExceeded = onBudgetExceeded
  }

  /** Record a cost from a span. */
  record(cost: SpanCost, procedure: string, kind: string): void {
    const now = Date.now()
    const dayStart = now - (now % DAY_MS)

    if (!this.#currentDay || this.#currentDay.time !== dayStart) {
      if (this.#currentDay) {
        this.#dailyBuckets.push(this.#currentDay)
        if (this.#dailyBuckets.length > MAX_DAILY_BUCKETS) this.#dailyBuckets.shift()
      }
      this.#currentDay = { time: dayStart, totalAmount: 0, byProvider: {}, byProcedure: {}, byKind: {} }
    }

    this.#currentDay.totalAmount += cost.amount
    const provider = cost.provider ?? 'unknown'
    this.#currentDay.byProvider[provider] = (this.#currentDay.byProvider[provider] ?? 0) + cost.amount
    this.#currentDay.byProcedure[procedure] = (this.#currentDay.byProcedure[procedure] ?? 0) + cost.amount
    this.#currentDay.byKind[kind] = (this.#currentDay.byKind[kind] ?? 0) + cost.amount

    // Check budget rules
    this.#checkBudgets()
  }

  /** Get cost summary. */
  getSummary(): CostSummary {
    const allBuckets = this.#currentDay ? [...this.#dailyBuckets, this.#currentDay] : [...this.#dailyBuckets]

    const summary: CostSummary = {
      totalAmount: 0,
      todayAmount: this.#currentDay?.totalAmount ?? 0,
      byProvider: {},
      byProcedure: {},
      byKind: {},
      dailyBuckets: allBuckets,
    }

    for (const bucket of allBuckets) {
      summary.totalAmount += bucket.totalAmount
      for (const [k, v] of Object.entries(bucket.byProvider)) {
        summary.byProvider[k] = (summary.byProvider[k] ?? 0) + v
      }
      for (const [k, v] of Object.entries(bucket.byProcedure)) {
        summary.byProcedure[k] = (summary.byProcedure[k] ?? 0) + v
      }
      for (const [k, v] of Object.entries(bucket.byKind)) {
        summary.byKind[k] = (summary.byKind[k] ?? 0) + v
      }
    }

    return summary
  }

  /** Export for persistence. */
  toJSON(): { dailyBuckets: CostBucket[]; currentDay: CostBucket | null } {
    return { dailyBuckets: this.#dailyBuckets, currentDay: this.#currentDay }
  }

  /** Restore from persistence. */
  hydrate(data: { dailyBuckets?: CostBucket[]; currentDay?: CostBucket | null }): void {
    if (Array.isArray(data.dailyBuckets)) this.#dailyBuckets = data.dailyBuckets
    if (data.currentDay) this.#currentDay = data.currentDay
  }

  #checkBudgets(): void {
    if (!this.#onBudgetExceeded) return

    const now = Date.now()

    for (const rule of this.#budgetRules) {
      let amount = 0
      const buckets = this.#currentDay ? [...this.#dailyBuckets, this.#currentDay] : this.#dailyBuckets

      let cutoff: number
      switch (rule.period) {
        case 'daily':
          cutoff = now - DAY_MS
          break
        case 'weekly':
          cutoff = now - 7 * DAY_MS
          break
        case 'monthly':
          cutoff = now - 30 * DAY_MS
          break
      }

      for (const bucket of buckets) {
        if (bucket.time < cutoff) continue
        if (rule.provider) {
          amount += bucket.byProvider[rule.provider] ?? 0
        } else if (rule.procedure) {
          amount += bucket.byProcedure[rule.procedure] ?? 0
        } else {
          amount += bucket.totalAmount
        }
      }

      if (amount >= rule.limit) {
        this.#onBudgetExceeded(rule, amount)
      }
    }
  }
}
