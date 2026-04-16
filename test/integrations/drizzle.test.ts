import { describe, expect, it } from 'vitest'

import { instrumentDrizzle, withCtx } from '#src/integrations/drizzle/index.ts'
import { RequestTrace } from '#src/plugins/analytics.ts'

// ── Mock DB Factory ─────────────────────────────────

function createMockDb(queryResult: unknown[] = [{ id: 1 }]) {
  const calls: { method: string; args: unknown[] }[] = []

  const makeSession = () => ({
    prepareQuery(...args: any[]) {
      calls.push({ method: 'prepareQuery', args })
      return {
        rawQueryConfig: { text: args[0]?.sql || 'SELECT 1' },
        execute: async (...execArgs: any[]) => {
          calls.push({ method: 'execute', args: execArgs })
          return queryResult
        },
      }
    },
    query: async (sql: string, params?: any[]) => {
      calls.push({ method: 'query', args: [sql, params] })
      return queryResult
    },
    transaction: async (callback: (tx: any) => any, txConfig?: any) => {
      const txSession = makeSession()
      return callback({ session: txSession })
    },
  })

  const session = makeSession()

  return {
    db: {
      session,
      _: { session },
    } as Record<string, any>,
    calls,
  }
}

function createClientOnlyDb(queryResult: unknown[] = [{ id: 1 }]) {
  const calls: { method: string; args: unknown[] }[] = []
  return {
    db: {
      $client: {
        query: async (...args: any[]) => {
          calls.push({ method: '$client.query', args })
          return queryResult
        },
      },
    } as Record<string, any>,
    calls,
  }
}

function createDeepSessionDb(queryResult: unknown[] = [{ id: 1 }]) {
  const calls: { method: string; args: unknown[] }[] = []
  return {
    db: {
      _: {
        session: {
          execute: async (...args: any[]) => {
            calls.push({ method: '_.session.execute', args })
            return queryResult
          },
        },
      },
    } as Record<string, any>,
    calls,
  }
}

// ── Tests ────────────────────────────────────────────

describe('instrumentDrizzle', () => {
  it('returns the same db instance', () => {
    const { db } = createMockDb()
    const result = instrumentDrizzle(db)
    expect(result).toBe(db)
  })

  it('is idempotent — calling twice does not double-patch', () => {
    const { db } = createMockDb()
    instrumentDrizzle(db)
    const firstPrepareQuery = db.session.prepareQuery

    instrumentDrizzle(db)
    expect(db.session.prepareQuery).toBe(firstPrepareQuery)
  })

  it('without withCtx — no spans recorded (noop passthrough)', async () => {
    const { db } = createMockDb([{ id: 42 }])
    instrumentDrizzle(db)

    const prepared = db.session.prepareQuery({ sql: 'SELECT * FROM "user"' })
    const result = await prepared.execute()

    expect(result).toEqual([{ id: 42 }])
    // No context, so no spans would be recorded anywhere
  })

  it('with withCtx — spans recorded with correct name, kind, duration', async () => {
    const { db } = createMockDb([{ id: 1 }])
    instrumentDrizzle(db)
    const reqTrace = new RequestTrace()
    const ctx = { trace: reqTrace }

    await withCtx(ctx, async () => {
      const prepared = db.session.prepareQuery({ sql: 'SELECT * FROM "user"' })
      return prepared.execute()
    })

    expect(reqTrace.spans).toHaveLength(1)
    const span = reqTrace.spans[0]!
    expect(span.name).toBe('db.select.user')
    expect(span.kind).toBe('db')
    expect(span.durationMs).toBeGreaterThanOrEqual(0)
    expect(span.startOffsetMs).toBeDefined()
    expect(span.error).toBeUndefined()
  })

  it('span name includes table: db.select.user', async () => {
    const { db } = createMockDb()
    instrumentDrizzle(db)
    const reqTrace = new RequestTrace()

    await withCtx({ trace: reqTrace }, async () => {
      const prepared = db.session.prepareQuery({ sql: 'SELECT * FROM "user" WHERE id = $1' })
      return prepared.execute()
    })

    expect(reqTrace.spans[0]!.name).toBe('db.select.user')
  })

  it('span name includes table: db.insert.session', async () => {
    const { db } = createMockDb()
    instrumentDrizzle(db)
    const reqTrace = new RequestTrace()

    await withCtx({ trace: reqTrace }, async () => {
      const prepared = db.session.prepareQuery({ sql: 'INSERT INTO "session" (id, userId) VALUES ($1, $2)' })
      return prepared.execute()
    })

    expect(reqTrace.spans[0]!.name).toBe('db.insert.session')
  })

  it('span name for UPDATE includes table', async () => {
    const { db } = createMockDb()
    instrumentDrizzle(db)
    const reqTrace = new RequestTrace()

    await withCtx({ trace: reqTrace }, async () => {
      const prepared = db.session.prepareQuery({ sql: 'UPDATE "order" SET status = $1 WHERE id = $2' })
      return prepared.execute()
    })

    expect(reqTrace.spans[0]!.name).toBe('db.update.order')
  })

  it('span name for DELETE includes table', async () => {
    const { db } = createMockDb()
    instrumentDrizzle(db)
    const reqTrace = new RequestTrace()

    await withCtx({ trace: reqTrace }, async () => {
      const prepared = db.session.prepareQuery({ sql: 'DELETE FROM "token" WHERE expired = true' })
      return prepared.execute()
    })

    expect(reqTrace.spans[0]!.name).toBe('db.delete.token')
  })

  it('config dbName appears in attributes["db.name"]', async () => {
    const { db } = createMockDb()
    instrumentDrizzle(db, { dbName: 'ecommerce' })
    const reqTrace = new RequestTrace()

    await withCtx({ trace: reqTrace }, async () => {
      const prepared = db.session.prepareQuery({ sql: 'SELECT 1' })
      return prepared.execute()
    })

    expect(reqTrace.spans[0]!.attributes!['db.name']).toBe('ecommerce')
  })

  it('config dbSystem appears in attributes["db.system"]', async () => {
    const { db } = createMockDb()
    instrumentDrizzle(db, { dbSystem: 'mysql' })
    const reqTrace = new RequestTrace()

    await withCtx({ trace: reqTrace }, async () => {
      const prepared = db.session.prepareQuery({ sql: 'SELECT 1' })
      return prepared.execute()
    })

    expect(reqTrace.spans[0]!.attributes!['db.system']).toBe('mysql')
  })

  it('defaults db.system to postgresql', async () => {
    const { db } = createMockDb()
    instrumentDrizzle(db)
    const reqTrace = new RequestTrace()

    await withCtx({ trace: reqTrace }, async () => {
      const prepared = db.session.prepareQuery({ sql: 'SELECT 1' })
      return prepared.execute()
    })

    expect(reqTrace.spans[0]!.attributes!['db.system']).toBe('postgresql')
  })

  it('config captureQueryText: false — no detail, no db.statement attribute', async () => {
    const { db } = createMockDb()
    instrumentDrizzle(db, { captureQueryText: false })
    const reqTrace = new RequestTrace()

    await withCtx({ trace: reqTrace }, async () => {
      const prepared = db.session.prepareQuery({ sql: 'SELECT * FROM "user"' })
      return prepared.execute()
    })

    const span = reqTrace.spans[0]!
    expect(span.detail).toBeUndefined()
    expect(span.attributes!['db.statement']).toBeUndefined()
  })

  it('config maxQueryTextLength — long query truncated with "..."', async () => {
    const { db } = createMockDb()
    instrumentDrizzle(db, { maxQueryTextLength: 20 })
    const reqTrace = new RequestTrace()
    const longQuery = 'SELECT * FROM "user" WHERE name = $1 AND email = $2 AND status = $3'

    await withCtx({ trace: reqTrace }, async () => {
      const prepared = db.session.prepareQuery({ sql: longQuery })
      return prepared.execute()
    })

    const span = reqTrace.spans[0]!
    expect(span.detail!.length).toBeLessThanOrEqual(23) // 20 + '...'
    expect(span.detail!.endsWith('...')).toBe(true)
    expect(span.attributes!['db.statement']).toBe(span.detail)
  })

  it('transaction spans have db.tx. prefix and db.transaction: true attribute', async () => {
    const { db } = createMockDb()
    instrumentDrizzle(db)
    const reqTrace = new RequestTrace()

    await withCtx({ trace: reqTrace }, async () => {
      return db.session.transaction(async (tx: any) => {
        const prepared = tx.session.prepareQuery({ sql: 'INSERT INTO "order" (id) VALUES ($1)' })
        return prepared.execute()
      })
    })

    expect(reqTrace.spans).toHaveLength(1)
    const span = reqTrace.spans[0]!
    expect(span.name).toBe('db.tx.insert.order')
    expect(span.attributes!['db.transaction']).toBe(true)
  })

  it('error spans include stack trace', async () => {
    const _calls: { method: string; args: unknown[] }[] = []
    const db = {
      session: {
        prepareQuery(...args: any[]) {
          return {
            rawQueryConfig: { text: args[0]?.sql || 'SELECT 1' },
            execute: async () => {
              throw new Error('connection refused')
            },
          }
        },
        query: async () => [],
        transaction: async (cb: any) => cb({ session: db.session }),
      },
      _: { session: {} },
    } as Record<string, any>
    db._.session = db.session

    instrumentDrizzle(db)
    const reqTrace = new RequestTrace()

    await expect(
      withCtx({ trace: reqTrace }, async () => {
        const prepared = db.session.prepareQuery({ sql: 'SELECT 1' })
        return prepared.execute()
      }),
    ).rejects.toThrow('connection refused')

    expect(reqTrace.spans).toHaveLength(1)
    const span = reqTrace.spans[0]!
    expect(span.error).toBeDefined()
    expect(span.error).toContain('connection refused')
    // Stack trace should include 'Error:' prefix
    expect(span.error).toContain('Error')
  })

  it('session.query patching works', async () => {
    const { db } = createMockDb([{ count: 5 }])
    instrumentDrizzle(db)
    const reqTrace = new RequestTrace()

    const result = await withCtx({ trace: reqTrace }, async () => {
      return db.session.query('SELECT COUNT(*) FROM "product"', [])
    })

    expect(result).toEqual([{ count: 5 }])
    expect(reqTrace.spans).toHaveLength(1)
    expect(reqTrace.spans[0]!.name).toBe('db.select.product')
  })

  it('$client fallback works when session is missing', async () => {
    const { db } = createClientOnlyDb([{ id: 99 }])
    instrumentDrizzle(db)
    const reqTrace = new RequestTrace()

    const result = await withCtx({ trace: reqTrace }, async () => {
      return db.$client.query('SELECT * FROM "store"')
    })

    expect(result).toEqual([{ id: 99 }])
    expect(reqTrace.spans).toHaveLength(1)
    expect(reqTrace.spans[0]!.name).toBe('db.select.store')
  })

  it('deep session execute fallback works (db._.session.execute)', async () => {
    const { db } = createDeepSessionDb([{ id: 77 }])
    instrumentDrizzle(db)
    const reqTrace = new RequestTrace()

    const result = await withCtx({ trace: reqTrace }, async () => {
      return db._.session.execute('SELECT * FROM "warehouse"')
    })

    expect(result).toEqual([{ id: 77 }])
    expect(reqTrace.spans).toHaveLength(1)
    expect(reqTrace.spans[0]!.name).toBe('db.select.warehouse')
  })

  it('peer attributes are recorded', async () => {
    const { db } = createMockDb()
    instrumentDrizzle(db, { peerName: 'db.example.com', peerPort: 5432 })
    const reqTrace = new RequestTrace()

    await withCtx({ trace: reqTrace }, async () => {
      const prepared = db.session.prepareQuery({ sql: 'SELECT 1' })
      return prepared.execute()
    })

    const attrs = reqTrace.spans[0]!.attributes!
    expect(attrs['net.peer.name']).toBe('db.example.com')
    expect(attrs['net.peer.port']).toBe(5432)
  })

  it('db.operation attribute is uppercase', async () => {
    const { db } = createMockDb()
    instrumentDrizzle(db)
    const reqTrace = new RequestTrace()

    await withCtx({ trace: reqTrace }, async () => {
      const prepared = db.session.prepareQuery({ sql: 'INSERT INTO "item" (name) VALUES ($1)' })
      return prepared.execute()
    })

    expect(reqTrace.spans[0]!.attributes!['db.operation']).toBe('INSERT')
  })

  it('warns when no patchable method found', () => {
    const warnSpy = { called: false }
    const origWarn = console.warn
    console.warn = (...args: any[]) => {
      if (String(args[0]).includes('[silgi/drizzle]')) warnSpy.called = true
    }

    const emptyDb = {} as Record<string, any>
    instrumentDrizzle(emptyDb)

    expect(warnSpy.called).toBe(true)
    console.warn = origWarn
  })

  it('handles null/undefined db gracefully', () => {
    expect(instrumentDrizzle(null as any)).toBe(null)
    expect(instrumentDrizzle(undefined as any)).toBe(undefined)
  })
})

describe('extractOperationInfo (via span names)', () => {
  const cases: [string, string][] = [
    ['SELECT * FROM "user"', 'db.select.user'],
    ['select id from user', 'db.select.user'],
    ['INSERT INTO "session" (id) VALUES ($1)', 'db.insert.session'],
    ['UPDATE "order" SET status = $1', 'db.update.order'],
    ['DELETE FROM "token" WHERE expired = true', 'db.delete.token'],
    ['BEGIN', 'db.begin'],
    ['COMMIT', 'db.commit'],
    ['ROLLBACK', 'db.rollback'],
    ['START TRANSACTION', 'db.begin'],
  ]

  for (const [sql, expectedName] of cases) {
    it(`"${sql}" -> span name "${expectedName}"`, async () => {
      const { db } = createMockDb()
      instrumentDrizzle(db)
      const reqTrace = new RequestTrace()

      await withCtx({ trace: reqTrace }, async () => {
        const prepared = db.session.prepareQuery({ sql })
        return prepared.execute()
      })

      expect(reqTrace.spans[0]!.name).toBe(expectedName)
    })
  }

  it('unknown SQL falls back to db.query', async () => {
    const { db } = createMockDb()
    instrumentDrizzle(db)
    const reqTrace = new RequestTrace()

    await withCtx({ trace: reqTrace }, async () => {
      const prepared = db.session.prepareQuery({ sql: 'EXPLAIN ANALYZE SELECT 1' })
      return prepared.execute()
    })

    // EXPLAIN is not in the known list, so extractOperationInfo returns null
    // but extractOperationName still returns 'EXPLAIN' for db.operation
    expect(reqTrace.spans[0]!.name).toBe('db.query')
    expect(reqTrace.spans[0]!.attributes!['db.operation']).toBe('EXPLAIN')
  })

  it('null/empty SQL yields db.query', async () => {
    // Build a db whose prepareQuery returns no rawQueryConfig.text
    const db = {
      session: {
        prepareQuery(...args: any[]) {
          return {
            rawQueryConfig: {},
            execute: async () => [{ id: 1 }],
          }
        },
        query: async () => [],
        transaction: async (cb: any) => cb({ session: db.session }),
      },
      _: { session: null as any },
    } as Record<string, any>
    db._.session = db.session

    instrumentDrizzle(db)
    const reqTrace = new RequestTrace()

    await withCtx({ trace: reqTrace }, async () => {
      const prepared = db.session.prepareQuery({})
      return prepared.execute()
    })

    expect(reqTrace.spans[0]!.name).toBe('db.query')
  })
})

describe('query text extraction formats', () => {
  it('extracts from { text: "..." } format', async () => {
    const { db } = createMockDb()
    // Override prepareQuery to return rawQueryConfig with text
    db.session.prepareQuery = (...args: any[]) => ({
      rawQueryConfig: { text: args[0]?.text || '' },
      execute: async () => [{ id: 1 }],
    })
    instrumentDrizzle(db)
    const reqTrace = new RequestTrace()

    await withCtx({ trace: reqTrace }, async () => {
      const prepared = db.session.prepareQuery({ text: 'SELECT * FROM "catalog"' })
      return prepared.execute()
    })

    expect(reqTrace.spans[0]!.name).toBe('db.select.catalog')
  })

  it('extracts from plain string query via session.query', async () => {
    const { db } = createMockDb()
    instrumentDrizzle(db)
    const reqTrace = new RequestTrace()

    await withCtx({ trace: reqTrace }, async () => {
      return db.session.query('DELETE FROM "expired_token"', [])
    })

    expect(reqTrace.spans[0]!.name).toBe('db.delete.expired_token')
  })
})

describe('concurrent context isolation', () => {
  it('different withCtx calls record to separate traces', async () => {
    const { db } = createMockDb()
    instrumentDrizzle(db)

    const trace1 = new RequestTrace()
    const trace2 = new RequestTrace()

    await Promise.all([
      withCtx({ trace: trace1 }, async () => {
        const p = db.session.prepareQuery({ sql: 'SELECT * FROM "user"' })
        return p.execute()
      }),
      withCtx({ trace: trace2 }, async () => {
        const p = db.session.prepareQuery({ sql: 'INSERT INTO "order" (id) VALUES ($1)' })
        return p.execute()
      }),
    ])

    expect(trace1.spans).toHaveLength(1)
    expect(trace1.spans[0]!.name).toBe('db.select.user')
    expect(trace2.spans).toHaveLength(1)
    expect(trace2.spans[0]!.name).toBe('db.insert.order')
  })
})
