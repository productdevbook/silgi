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
    stack:
      'SilgiError: Forbidden\n    at Object.handler (src/procedures/todos.ts:48:9)\n    at compiledPipeline (src/compile.ts:209:18)',
    input: { id: 42 },
    headers: { 'content-type': 'application/json', authorization: 'Bearer eyJ...', 'user-agent': 'Mozilla/5.0' },
    durationMs: 3.62,
    output: null, headers: {}, responseHeaders: {}, spans: [
      { kind: 'db', name: 'db.todos.findById', durationMs: 2.1 },
      { kind: 'db', name: 'auth.checkOwnership', durationMs: 1.3, error: 'Forbidden: you do not own this todo' },
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
    output: null, headers: {}, responseHeaders: {}, spans: [],
  },
  {
    id: 3,
    timestamp: timeAgo(60 * SEC),
    procedure: 'todos/toggle',
    error: 'Not Found',
    code: 'NOT_FOUND',
    status: 404,
    stack:
      'SilgiError: Not Found\n    at Object.handler (src/procedures/todos.ts:28:9)\n    at compiledPipeline (src/compile.ts:209:18)',
    input: { id: 99999 },
    headers: { 'content-type': 'application/json', 'user-agent': 'curl/8.7.1' },
    durationMs: 3.54,
    output: null, headers: {}, responseHeaders: {}, spans: [{ kind: 'db', name: 'db.todos.findById', durationMs: 3.43 }],
  },
]

export const mockRequests: RequestEntry[] = [
  {
    id: 1, requestId: "req-1-a3f2c1", sessionId: "ses-1-x7k9m2",
    timestamp: timeAgo(2 * SEC),
    durationMs: 4.82,
    method: 'GET',
    path: '/todos/list',
    ip: '127.0.0.1',
    headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0' },
    responseHeaders: { 'content-type': 'application/json' },
    userAgent: 'Mozilla/5.0',
    status: 200,
    isBatch: false,
    procedures: [{
      procedure: 'todos/list',
      durationMs: 4.82,
      status: 200,
      input: undefined,
      output: null,
      spans: [
        { kind: 'cache', name: 'cache.get', durationMs: 0.12, startOffsetMs: 0.1 },
        { kind: 'db', name: 'db.todos.findMany', durationMs: 3.87, startOffsetMs: 0.3, detail: 'SELECT * FROM todos ORDER BY created_at DESC' },
        { kind: 'cache', name: 'cache.set', durationMs: 0.41, startOffsetMs: 4.2 },
      ],
    }],
  },
  {
    id: 2, requestId: "req-2-b7d4e9", sessionId: "ses-1-x7k9m2",
    timestamp: timeAgo(3 * SEC),
    durationMs: 18.3,
    method: 'POST',
    path: '/todos/create',
    ip: '127.0.0.1',
    headers: { 'content-type': 'application/json' },
    responseHeaders: {},
    userAgent: 'Mozilla/5.0',
    status: 200,
    isBatch: false,
    procedures: [{
      procedure: 'todos/create',
      durationMs: 18.3,
      status: 200,
      input: { title: 'Buy groceries' },
      output: { id: 42, title: 'Buy groceries', done: false },
      spans: [
        { kind: 'db', name: 'db.todos.create', durationMs: 12.4, startOffsetMs: 0.5, detail: 'INSERT INTO todos (title) VALUES ($1)' },
        { kind: 'cache', name: 'cache.invalidate', durationMs: 0.8, startOffsetMs: 13.1 },
        { kind: 'queue', name: 'queue.publish:todo.created', durationMs: 4.1, startOffsetMs: 14.0 },
      ],
    }],
  },
  {
    id: 3, requestId: "req-3-c1f8a2", sessionId: "ses-2-p4r8w1",
    timestamp: timeAgo(5 * SEC),
    durationMs: 24.5,
    method: 'POST',
    path: '/batch',
    ip: '192.168.1.50',
    headers: { 'content-type': 'application/json', authorization: '[REDACTED]' },
    responseHeaders: {},
    userAgent: 'curl/8.7.1',
    status: 200,
    isBatch: true,
    procedures: [
      {
        procedure: 'users/me',
        durationMs: 2.1,
        status: 200,
        input: undefined,
        output: { id: 1, name: 'Alice' },
        spans: [
          { kind: 'cache', name: 'cache.get:session', durationMs: 0.3, startOffsetMs: 0.1 },
          { kind: 'db', name: 'db.users.findById', durationMs: 1.6, startOffsetMs: 0.5, detail: 'SELECT * FROM users WHERE id = $1' },
        ],
      },
      {
        procedure: 'todos/list',
        durationMs: 5.2,
        status: 200,
        input: undefined,
        output: null,
        spans: [
          { kind: 'db', name: 'db.todos.findMany', durationMs: 4.8, startOffsetMs: 2.3, detail: 'SELECT * FROM todos WHERE user_id = $1' },
        ],
      },
      {
        procedure: 'notifications/unread',
        durationMs: 1.1,
        status: 200,
        input: undefined,
        output: { count: 3 },
        spans: [
          { kind: 'cache', name: 'cache.get:unread', durationMs: 0.2, startOffsetMs: 7.6 },
        ],
      },
    ],
  },
  {
    id: 4, requestId: "req-4-d9e3b7", sessionId: "ses-1-x7k9m2",
    timestamp: timeAgo(7 * SEC),
    durationMs: 9.7,
    method: 'POST',
    path: '/todos/toggle',
    ip: '127.0.0.1',
    headers: {},
    responseHeaders: {},
    userAgent: 'Mozilla/5.0',
    status: 200,
    isBatch: false,
    procedures: [{
      procedure: 'todos/toggle',
      durationMs: 9.7,
      status: 200,
      input: { id: 5 },
      output: null,
      spans: [
        { kind: 'db', name: 'db.todos.findById', durationMs: 2.1, startOffsetMs: 0.2 },
        { kind: 'db', name: 'db.todos.update', durationMs: 5.8, startOffsetMs: 2.5, detail: 'UPDATE todos SET done = NOT done WHERE id = $1' },
        { kind: 'cache', name: 'cache.invalidate', durationMs: 0.6, startOffsetMs: 8.5 },
        { kind: 'http', name: 'http.webhook', durationMs: 0.9, startOffsetMs: 9.2, detail: 'POST https://hooks.example.com/todo-updated' },
      ],
    }],
  },
]
