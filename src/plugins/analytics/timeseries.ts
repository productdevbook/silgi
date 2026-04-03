/**
 * Analytics Time-Series — multi-tier bucketed aggregation with automatic downsampling.
 *
 * Three tiers:
 * - minute: 1-minute buckets, last 60 minutes
 * - hour: 1-hour buckets, last 24 hours
 * - day: 1-day buckets, last 30 days
 */

// ── Types ──

export interface TimeSeriesBucket {
  time: number // bucket start timestamp (ms)
  count: number
  errors: number
  totalLatency: number
  minLatency: number
  maxLatency: number
}

export interface TimeSeriesSnapshot {
  time: number
  count: number
  errors: number
  errorRate: number
  avgLatency: number
  minLatency: number
  maxLatency: number
}

export type TimeRange = '1h' | '6h' | '24h' | '7d' | '30d'

// ── Constants ──

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

const MAX_MINUTE_BUCKETS = 60 // 1 hour
const MAX_HOUR_BUCKETS = 24 // 1 day
const MAX_DAY_BUCKETS = 30 // 1 month

// ── Aggregator ──

export class TimeSeriesAggregator {
  #minutes: TimeSeriesBucket[] = []
  #hours: TimeSeriesBucket[] = []
  #days: TimeSeriesBucket[] = []
  #currentMinute: TimeSeriesBucket | null = null
  #rollupTimer: ReturnType<typeof setInterval> | null = null

  constructor() {
    // Rollup timer: every minute, roll minute → hour; every hour, roll hour → day
    this.#rollupTimer = setInterval(() => this.#rollup(), MINUTE_MS)
    if (typeof this.#rollupTimer === 'object' && 'unref' in this.#rollupTimer) {
      this.#rollupTimer.unref()
    }
  }

  /** Record a request. */
  record(durationMs: number, isError: boolean): void {
    const now = Date.now()
    const minuteStart = now - (now % MINUTE_MS)

    if (!this.#currentMinute || this.#currentMinute.time !== minuteStart) {
      // Flush previous minute bucket
      if (this.#currentMinute) {
        this.#minutes.push(this.#currentMinute)
        if (this.#minutes.length > MAX_MINUTE_BUCKETS) this.#minutes.shift()
      }
      this.#currentMinute = createBucket(minuteStart)
    }

    this.#currentMinute.count++
    if (isError) this.#currentMinute.errors++
    this.#currentMinute.totalLatency += durationMs
    if (durationMs < this.#currentMinute.minLatency) this.#currentMinute.minLatency = durationMs
    if (durationMs > this.#currentMinute.maxLatency) this.#currentMinute.maxLatency = durationMs
  }

  /** Get time-series for a given range. */
  query(range: TimeRange): TimeSeriesSnapshot[] {
    // Flush current minute
    this.#flushCurrentMinute()

    switch (range) {
      case '1h':
        return this.#minutes.map(toSnapshot)
      case '6h': {
        // 6 hours = use minute buckets (up to 60) + recent hours
        const cutoff = Date.now() - 6 * HOUR_MS
        const hourData = this.#hours.filter((b) => b.time >= cutoff).map(toSnapshot)
        const minuteData = this.#minutes.map(toSnapshot)
        return [...hourData, ...minuteData]
      }
      case '24h':
        return this.#hours.map(toSnapshot)
      case '7d': {
        const cutoff = Date.now() - 7 * DAY_MS
        return this.#days.filter((b) => b.time >= cutoff).map(toSnapshot)
      }
      case '30d':
        return this.#days.map(toSnapshot)
    }
  }

  /** Export state for persistence. */
  toJSON(): { minutes: TimeSeriesBucket[]; hours: TimeSeriesBucket[]; days: TimeSeriesBucket[] } {
    this.#flushCurrentMinute()
    return {
      minutes: this.#minutes,
      hours: this.#hours,
      days: this.#days,
    }
  }

  /** Restore from persisted state. */
  hydrate(data: { minutes?: TimeSeriesBucket[]; hours?: TimeSeriesBucket[]; days?: TimeSeriesBucket[] }): void {
    if (Array.isArray(data.minutes)) this.#minutes = data.minutes
    if (Array.isArray(data.hours)) this.#hours = data.hours
    if (Array.isArray(data.days)) this.#days = data.days
  }

  #flushCurrentMinute(): void {
    if (this.#currentMinute && this.#currentMinute.count > 0) {
      const minuteStart = Date.now() - (Date.now() % MINUTE_MS)
      if (this.#currentMinute.time !== minuteStart) {
        this.#minutes.push(this.#currentMinute)
        if (this.#minutes.length > MAX_MINUTE_BUCKETS) this.#minutes.shift()
        this.#currentMinute = null
      }
    }
  }

  #rollup(): void {
    const now = Date.now()

    // Roll completed minute buckets into hour buckets
    const hourStart = now - (now % HOUR_MS)
    const completedMinutes = this.#minutes.filter((b) => b.time < hourStart)
    if (completedMinutes.length > 0) {
      // Group by hour
      const byHour = new Map<number, TimeSeriesBucket[]>()
      for (const b of completedMinutes) {
        const hStart = b.time - (b.time % HOUR_MS)
        const arr = byHour.get(hStart)
        if (arr) arr.push(b)
        else byHour.set(hStart, [b])
      }

      for (const [hStart, buckets] of byHour) {
        const existing = this.#hours.find((h) => h.time === hStart)
        if (existing) {
          mergeBucketInto(existing, buckets)
        } else {
          this.#hours.push(mergeBuckets(hStart, buckets))
          if (this.#hours.length > MAX_HOUR_BUCKETS) this.#hours.shift()
        }
      }

      // Remove rolled-up minute buckets
      this.#minutes = this.#minutes.filter((b) => b.time >= hourStart)
    }

    // Roll completed hour buckets into day buckets
    const dayStart = now - (now % DAY_MS)
    const completedHours = this.#hours.filter((b) => b.time < dayStart)
    if (completedHours.length > 0) {
      const byDay = new Map<number, TimeSeriesBucket[]>()
      for (const b of completedHours) {
        const dStart = b.time - (b.time % DAY_MS)
        const arr = byDay.get(dStart)
        if (arr) arr.push(b)
        else byDay.set(dStart, [b])
      }

      for (const [dStart, buckets] of byDay) {
        const existing = this.#days.find((d) => d.time === dStart)
        if (existing) {
          mergeBucketInto(existing, buckets)
        } else {
          this.#days.push(mergeBuckets(dStart, buckets))
          if (this.#days.length > MAX_DAY_BUCKETS) this.#days.shift()
        }
      }

      this.#hours = this.#hours.filter((b) => b.time >= dayStart)
    }
  }

  dispose(): void {
    if (this.#rollupTimer) clearInterval(this.#rollupTimer)
    this.#rollupTimer = null
  }
}

// ── Helpers ──

function createBucket(time: number): TimeSeriesBucket {
  return { time, count: 0, errors: 0, totalLatency: 0, minLatency: Infinity, maxLatency: 0 }
}

function mergeBuckets(time: number, buckets: TimeSeriesBucket[]): TimeSeriesBucket {
  const merged = createBucket(time)
  for (const b of buckets) {
    merged.count += b.count
    merged.errors += b.errors
    merged.totalLatency += b.totalLatency
    if (b.minLatency < merged.minLatency) merged.minLatency = b.minLatency
    if (b.maxLatency > merged.maxLatency) merged.maxLatency = b.maxLatency
  }
  return merged
}

function mergeBucketInto(target: TimeSeriesBucket, buckets: TimeSeriesBucket[]): void {
  for (const b of buckets) {
    target.count += b.count
    target.errors += b.errors
    target.totalLatency += b.totalLatency
    if (b.minLatency < target.minLatency) target.minLatency = b.minLatency
    if (b.maxLatency > target.maxLatency) target.maxLatency = b.maxLatency
  }
}

function toSnapshot(b: TimeSeriesBucket): TimeSeriesSnapshot {
  return {
    time: b.time,
    count: b.count,
    errors: b.errors,
    errorRate: b.count > 0 ? (b.errors / b.count) * 100 : 0,
    avgLatency: b.count > 0 ? b.totalLatency / b.count : 0,
    minLatency: b.minLatency === Infinity ? 0 : b.minLatency,
    maxLatency: b.maxLatency,
  }
}
