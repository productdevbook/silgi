import { describe, expect, it } from 'vitest'

import {
  SLOW_REQUEST_MS,
  filterErrors,
  filterRequests,
} from '../../dashboard/src/lib/list-filters'
import { mockErrors, mockRequests } from '../../dashboard/src/lib/mock-data'

describe('dashboard list filters', () => {
  it('filters requests by procedure, status, and latency bands', () => {
    const requests = [
      ...mockRequests,
      {
        ...mockRequests[0]!,
        id: 100,
        status: 500,
        durationMs: SLOW_REQUEST_MS + 50,
        procedures: [{ ...mockRequests[0]!.procedures[0]!, procedure: 'todos/delete', status: 500, durationMs: SLOW_REQUEST_MS + 50 }],
      },
      {
        ...mockRequests[1]!,
        id: 101,
        status: 404,
        durationMs: SLOW_REQUEST_MS - 10,
        procedures: [{ ...mockRequests[1]!.procedures[0]!, procedure: 'users/me', status: 404, durationMs: SLOW_REQUEST_MS - 10 }],
      },
    ]

    const result = filterRequests(requests, {
      query: 'todos',
      procedure: 'todos/delete',
      status: 'server',
      latency: 'slow',
    })

    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe(100)
  })

  it('filters errors by query, severity, and trace presence', () => {
    const result = filterErrors(mockErrors, {
      query: 'forbidden',
      procedure: 'todos/delete',
      severity: 'client',
      trace: 'traced',
    })

    expect(result).toHaveLength(1)
    expect(result[0]?.code).toBe('FORBIDDEN')
  })
})
