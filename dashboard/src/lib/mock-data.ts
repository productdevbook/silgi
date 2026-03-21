import type { AnalyticsData, ErrorEntry, RequestEntry } from './types'

const NOW = Date.now()
const SEC = 1000

function rand(min: number, max: number) {
  return Math.round((min + Math.random() * (max - min)) * 100) / 100
}

function timeAgo(ms: number) {
  return NOW - ms
}

export const mockData: AnalyticsData = {
  uptime: 3847,
  totalRequests: 12847,
  totalErrors: 23,
  errorRate: 0.18,
  requestsPerSecond: 3.34,
  avgLatency: 12.4,
  procedures: {
    'todos/list': {
      count: 5230,
      errors: 2,
      errorRate: 0.04,
      latency: { avg: 4.2, p50: 3.1, p95: 8.7, p99: 18.3 },
      lastError: 'Connection timeout',
      lastErrorTime: timeAgo(120 * SEC),
    },
    'todos/create': {
      count: 2841,
      errors: 8,
      errorRate: 0.28,
      latency: { avg: 15.6, p50: 12.3, p95: 35.2, p99: 68.1 },
      lastError: 'Validation failed',
      lastErrorTime: timeAgo(30 * SEC),
    },
    'todos/toggle': {
      count: 2104,
      errors: 5,
      errorRate: 0.24,
      latency: { avg: 8.9, p50: 7.1, p95: 19.4, p99: 42.6 },
      lastError: 'Not Found',
      lastErrorTime: timeAgo(60 * SEC),
    },
    'users/me': {
      count: 1890,
      errors: 0,
      errorRate: 0,
      latency: { avg: 2.1, p50: 1.8, p95: 4.2, p99: 8.5 },
      lastError: null,
      lastErrorTime: null,
    },
    'todos/delete': {
      count: 782,
      errors: 8,
      errorRate: 1.02,
      latency: { avg: 11.3, p50: 9.4, p95: 24.1, p99: 55.2 },
      lastError: 'Forbidden',
      lastErrorTime: timeAgo(15 * SEC),
    },
  },
  timeSeries: Array.from({ length: 60 }, (_, i) => ({
    time: Math.floor((NOW - (60 - i) * SEC) / 1000),
    count: Math.floor(rand(1, 8)),
    errors: Math.random() > 0.85 ? Math.floor(rand(1, 3)) : 0,
  })),
}

export const mockErrors: ErrorEntry[] = [
  {
    id: 1,
    timestamp: timeAgo(15 * SEC),
    procedure: 'todos/delete',
    error: 'Forbidden: you do not own this todo',
    code: 'FORBIDDEN',
    status: 403,
    stack: 'SilgiError: Forbidden\n    at Object.handler (src/procedures/todos.ts:48:9)\n    at compiledPipeline (src/compile.ts:209:18)',
    input: { id: 42 },
    headers: { 'content-type': 'application/json', 'authorization': 'Bearer eyJ...', 'user-agent': 'Mozilla/5.0' },
    durationMs: 3.62,
    spans: [
      { name: 'db.todos.findById', durationMs: 2.1 },
      { name: 'auth.checkOwnership', durationMs: 1.3, error: 'Forbidden: you do not own this todo' },
    ],
  },
  {
    id: 2,
    timestamp: timeAgo(30 * SEC),
    procedure: 'todos/create',
    error: 'Validation failed: title must be at least 1 character',
    code: 'BAD_REQUEST',
    status: 400,
    stack: 'ValidationError: Validation failed\n    at validateSchema (src/core/schema.ts:12:49)',
    input: { title: '' },
    headers: { 'content-type': 'application/json', 'user-agent': 'curl/8.7.1' },
    durationMs: 0.35,
    spans: [],
  },
  {
    id: 3,
    timestamp: timeAgo(60 * SEC),
    procedure: 'todos/toggle',
    error: 'Not Found',
    code: 'NOT_FOUND',
    status: 404,
    stack: 'SilgiError: Not Found\n    at Object.handler (src/procedures/todos.ts:28:9)\n    at compiledPipeline (src/compile.ts:209:18)',
    input: { id: 99999 },
    headers: { 'content-type': 'application/json', 'user-agent': 'curl/8.7.1' },
    durationMs: 3.54,
    spans: [
      { name: 'db.todos.findById', durationMs: 3.43 },
    ],
  },
]

export const mockRequests: RequestEntry[] = [
  {
    id: 1,
    timestamp: timeAgo(2 * SEC),
    procedure: 'todos/list',
    durationMs: 4.82,
    status: 200,
    input: undefined,
    spans: [
      { name: 'cache.get', durationMs: 0.12 },
      { name: 'db.todos.findMany', durationMs: 3.87 },
      { name: 'cache.set', durationMs: 0.41 },
    ],
  },
  {
    id: 2,
    timestamp: timeAgo(3 * SEC),
    procedure: 'todos/create',
    durationMs: 18.3,
    status: 200,
    input: { title: 'Buy groceries' },
    spans: [
      { name: 'db.todos.create', durationMs: 12.4 },
      { name: 'cache.invalidate', durationMs: 0.8 },
      { name: 'queue.publish:todo.created', durationMs: 4.1 },
    ],
  },
  {
    id: 3,
    timestamp: timeAgo(5 * SEC),
    procedure: 'users/me',
    durationMs: 2.1,
    status: 200,
    input: undefined,
    spans: [
      { name: 'cache.get:session', durationMs: 0.3 },
      { name: 'db.users.findById', durationMs: 1.6 },
    ],
  },
  {
    id: 4,
    timestamp: timeAgo(7 * SEC),
    procedure: 'todos/toggle',
    durationMs: 9.7,
    status: 200,
    input: { id: 5 },
    spans: [
      { name: 'db.todos.findById', durationMs: 2.1 },
      { name: 'db.todos.update', durationMs: 5.8 },
      { name: 'cache.invalidate', durationMs: 0.6 },
      { name: 'http.webhook', durationMs: 0.9 },
    ],
  },
  {
    id: 5,
    timestamp: timeAgo(10 * SEC),
    procedure: 'todos/list',
    durationMs: 1.2,
    status: 200,
    input: undefined,
    spans: [
      { name: 'cache.get', durationMs: 0.15 },
    ],
  },
]
