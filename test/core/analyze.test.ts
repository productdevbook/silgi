/**
 * Static handler analysis tests — Sucrose-style optimization.
 */

import { describe, it, expect } from 'vitest'

import { analyzeHandler, getOptimizationHints } from '#src/analyze.ts'

describe('analyzeHandler', () => {
  it('detects ctx usage via destructuring', () => {
    const r = analyzeHandler(({ ctx }: any) => ctx.db.find())
    expect(r.usesContext).toBe(true)
    expect(r.usesInput).toBe(false)
  })

  it('detects input usage via destructuring', () => {
    const r = analyzeHandler(({ input }: any) => input.name)
    expect(r.usesInput).toBe(true)
    expect(r.usesContext).toBe(false)
  })

  it('detects both ctx and input', () => {
    const r = analyzeHandler(({ ctx, input }: any) => ctx.db.get(input.id))
    expect(r.usesContext).toBe(true)
    expect(r.usesInput).toBe(true)
  })

  it('detects fail usage', () => {
    const r = analyzeHandler(({ fail }: any) => {
      fail('NOT_FOUND')
    })
    expect(r.usesFail).toBe(true)
  })

  it('detects signal usage', () => {
    const r = analyzeHandler(({ signal }: any) => fetch('/api', { signal }))
    expect(r.usesSignal).toBe(true)
  })

  it('detects async handlers', () => {
    const r = analyzeHandler(async ({ input }: any) => input)
    expect(r.isAsync).toBe(true)
  })

  it('detects sync handlers', () => {
    const r = analyzeHandler(({ input }: any) => input)
    expect(r.isAsync).toBe(false)
  })

  it('detects nothing-used handler', () => {
    const r = analyzeHandler(() => ({ status: 'ok' }))
    expect(r.usesContext).toBe(false)
    expect(r.usesInput).toBe(false)
    expect(r.usesFail).toBe(false)
    expect(r.usesSignal).toBe(false)
    expect(r.isAsync).toBe(false)
  })

  it('handles property access pattern (opts.ctx)', () => {
    const r = analyzeHandler((opts: any) => opts.ctx.db.find())
    expect(r.usesContext).toBe(true)
  })

  // Known false positive cases (documenting current behavior)
  it('false positive: "input" in string literal triggers usesInput', () => {
    const r = analyzeHandler(() => 'the input is validated')
    // Known limitation: regex matches word in string literals
    expect(r.usesInput).toBe(true)
  })

  it('false positive: "context" as standalone word in string triggers usesContext', () => {
    const r = analyzeHandler(() => {
      // The context is important
      return 'context matters'
    })
    // Known limitation: /\bcontext\b/ matches the word "context" in comments and strings
    expect(r.usesContext).toBe(true)
  })
})

describe('getOptimizationHints', () => {
  it("skips body parse when handler doesn't use input", () => {
    const a = analyzeHandler(() => ({ ok: true }))
    const h = getOptimizationHints(a, false)
    expect(h.skipBodyParse).toBe(true)
    expect(h.skipContext).toBe(true)
    expect(h.skipFail).toBe(true)
    expect(h.guaranteedSync).toBe(true)
  })

  it("doesn't skip body parse when schema requires input", () => {
    const a = analyzeHandler(() => ({ ok: true }))
    const h = getOptimizationHints(a, true) // has input schema
    expect(h.skipBodyParse).toBe(false)
  })

  it('skips context when handler is pure', () => {
    const a = analyzeHandler(({ input }: any) => ({ echo: input }))
    const h = getOptimizationHints(a, true)
    expect(h.skipContext).toBe(true)
    expect(h.skipBodyParse).toBe(false)
  })

  it('full handler uses everything', () => {
    const a = analyzeHandler(async ({ ctx, input, fail, signal: _signal }: any) => {
      if (!ctx.auth) fail('UNAUTHORIZED')
      return ctx.db.get(input.id)
    })
    const h = getOptimizationHints(a, true)
    expect(h.skipBodyParse).toBe(false)
    expect(h.skipContext).toBe(false)
    expect(h.skipFail).toBe(false)
    expect(h.guaranteedSync).toBe(false)
  })
})
