/**
 * SilgiError — unified RPC error type for the Silgi framework.
 *
 * @remarks
 * Every error thrown through the Silgi request pipeline is either a
 * `SilgiError` or is wrapped into one by {@link toSilgiError} before it
 * reaches the wire. The class carries an HTTP `status`, a machine-readable
 * `code`, optional structured `data`, and a `defined` flag that signals
 * whether the error was deliberately declared with `$errors()` (safe to
 * expose verbatim to clients) or is an internal fault that should be
 * redacted.
 *
 * ### Cross-realm `instanceof`
 * `SilgiError` overrides `Symbol.hasInstance` to check a brand symbol
 * (`Symbol.for('silgi.error.brand.v1')`) stamped on `SilgiError.prototype`.
 * Because `Symbol.for` resolves through the global symbol registry shared
 * across all V8 realms (worker threads, `node:vm` contexts), `instanceof
 * SilgiError` works even when the `SilgiError` class used to construct the
 * error originated in a different realm.
 *
 * ### Subclassing
 * User-defined subclasses are fully supported:
 * ```ts
 * class AuthError extends SilgiError<'UNAUTHORIZED'> {
 *   constructor() { super('UNAUTHORIZED', { status: 401 }) }
 * }
 * ```
 * The brand is inherited through the prototype chain automatically — no
 * extra steps are required in the subclass constructor.
 *
 * @category Errors
 */

/** Well-known HTTP error codes with their default status and message. */
const COMMON_ERRORS = /* @__PURE__ */ Object.freeze({
  BAD_REQUEST: { status: 400, message: 'Bad Request' },
  UNAUTHORIZED: { status: 401, message: 'Unauthorized' },
  FORBIDDEN: { status: 403, message: 'Forbidden' },
  NOT_FOUND: { status: 404, message: 'Not Found' },
  METHOD_NOT_ALLOWED: { status: 405, message: 'Method Not Allowed' },
  NOT_ACCEPTABLE: { status: 406, message: 'Not Acceptable' },
  CONFLICT: { status: 409, message: 'Conflict' },
  GONE: { status: 410, message: 'Gone' },
  UNPROCESSABLE_CONTENT: { status: 422, message: 'Unprocessable Content' },
  PRECONDITION_REQUIRED: { status: 428, message: 'Precondition Required' },
  TOO_MANY_REQUESTS: { status: 429, message: 'Too Many Requests' },
  CLIENT_CLOSED_REQUEST: { status: 499, message: 'Client Closed Request' },
  INTERNAL_SERVER_ERROR: { status: 500, message: 'Internal Server Error' },
  NOT_IMPLEMENTED: { status: 501, message: 'Not Implemented' },
  BAD_GATEWAY: { status: 502, message: 'Bad Gateway' },
  SERVICE_UNAVAILABLE: { status: 503, message: 'Service Unavailable' },
  GATEWAY_TIMEOUT: { status: 504, message: 'Gateway Timeout' },
} as const)

export type SilgiErrorCode = keyof typeof COMMON_ERRORS | (string & {})

/** Options passed to the {@link SilgiError} constructor. */
export interface SilgiErrorOptions<TData = unknown> {
  status?: number
  message?: string
  data?: TData
  cause?: unknown
  defined?: boolean
}

/** Wire-format representation of a {@link SilgiError}, safe to JSON-stringify and transmit to clients. */
export interface SilgiErrorJSON<TCode extends string = string, TData = unknown> {
  defined: boolean
  code: TCode
  status: number
  message: string
  data: TData
}

/**
 * Non-enumerable brand symbol stamped on `SilgiError.prototype`.
 *
 * Using `Symbol.for` ensures the key is resolved from the global symbol
 * registry, which is shared across all V8 realms (worker threads,
 * `node:vm` contexts). This makes cross-realm `instanceof` and
 * {@link isSilgiError} checks reliable without any module-level WeakSet
 * or `globalThis` state.
 *
 * The `.brand.v1` suffix prevents accidental collision with user code that
 * might use the shorter `Symbol.for('silgi.error')` for unrelated purposes,
 * and reserves the `v1` slot for a future migration if brand semantics change.
 *
 * @internal
 */
const BRAND = Symbol.for('silgi.error.brand.v1')

/**
 * A typed, serializable RPC error.
 *
 * @typeParam TCode - String literal type for the error code.
 * @typeParam TData - Shape of the optional structured data payload.
 *
 * @example
 * ```ts
 * throw new SilgiError('NOT_FOUND', { message: 'User 42 not found' })
 * ```
 *
 * @example Checking for Silgi errors in a catch block
 * ```ts
 * import { isSilgiError } from 'silgi'
 *
 * try {
 *   await client.users.get({ id: '42' })
 * } catch (e) {
 *   if (isSilgiError(e)) {
 *     console.error(e.code, e.status)
 *   }
 * }
 * ```
 *
 * @see {@link isSilgiError} Preferred type-guard over `instanceof` for cross-realm safety.
 * @see {@link toSilgiError} Wraps any unknown error into a `SilgiError`.
 * @see {@link fromSilgiErrorJSON} Reconstructs a `SilgiError` from a wire-format JSON object.
 *
 * @remarks
 * **Do not mutate the prototype brand.** Removing or overwriting
 * `SilgiError.prototype[Symbol.for('silgi.error.brand.v1')]` will break
 * cross-realm detection for all instances in the current realm.
 *
 * **Subclass note.** If a subclass overrides the constructor and somehow
 * replaces `Object.getPrototypeOf(this)` before construction completes,
 * the inherited brand may be severed. This is an extremely unusual pattern
 * and is not supported.
 *
 * @category Errors
 */
export class SilgiError<TCode extends string = string, TData = unknown> extends Error {
  /** Machine-readable error code (e.g. `'NOT_FOUND'`). */
  readonly code: TCode
  /** HTTP status code associated with this error. */
  readonly status: number
  /** Optional structured payload carrying additional error context. */
  readonly data: TData
  /**
   * `true` when this error was declared via `$errors()` and is safe to
   * expose verbatim to clients; `false` for internal faults.
   */
  readonly defined: boolean

  /**
   * @param code - Machine-readable error code. Well-known codes (e.g.
   *   `'NOT_FOUND'`, `'UNAUTHORIZED'`) resolve default `status` and
   *   `message` values automatically.
   * @param options - Override `status`, `message`, `data`, `cause`, and
   *   `defined` fields.
   */
  constructor(code: TCode, options: SilgiErrorOptions<TData> = {}) {
    const defaults = COMMON_ERRORS[code as keyof typeof COMMON_ERRORS]
    const message = options.message ?? defaults?.message ?? code
    super(message, options.cause ? { cause: options.cause } : undefined)
    this.code = code
    this.status = options.status ?? defaults?.status ?? 500
    this.data = options.data as TData
    this.defined = options.defined ?? false
    this.name = 'SilgiError'
  }

  /**
   * Serialize this error to a plain object suitable for JSON transmission.
   *
   * @remarks
   * The brand symbol (`Symbol.for('silgi.error.brand.v1')`) is
   * non-enumerable and lives on the prototype, so it is never included
   * in the output of `toJSON()` or `JSON.stringify()`.
   *
   * @returns A {@link SilgiErrorJSON} with `defined`, `code`, `status`,
   *   `message`, and `data` fields — and nothing else.
   */
  toJSON(): SilgiErrorJSON<TCode, TData> {
    return {
      defined: this.defined,
      code: this.code,
      status: this.status,
      message: this.message,
      data: this.data,
    }
  }

  /**
   * Custom `instanceof` check that works across V8 realms.
   *
   * @remarks
   * Checks for the presence of `Symbol.for('silgi.error.brand.v1')` on
   * the candidate value's prototype chain. Because `Symbol.for` resolves
   * through the global symbol registry (shared across all realms), this
   * correctly identifies `SilgiError` instances that were constructed in a
   * worker thread or `node:vm` context.
   *
   * This is an O(1) property lookup — no prototype walk is performed.
   *
   * @param instance - The value to test.
   * @returns `true` if `instance` carries the Silgi error brand.
   */
  static override [Symbol.hasInstance](instance: unknown): boolean {
    return typeof instance === 'object' && instance !== null && (instance as any)[BRAND] === true
  }
}

// Stamp the brand on the prototype once, non-enumerable and non-writable.
// All instances — including those of user-defined subclasses — inherit it
// through the normal prototype chain without any per-instance allocation.
Reflect.defineProperty(SilgiError.prototype, BRAND, {
  value: true,
  enumerable: false,
  writable: false,
  configurable: false,
})

/**
 * Type guard that returns `true` when `e` is a {@link SilgiError}.
 *
 * @remarks
 * Prefer this function over `instanceof SilgiError` in application code.
 * The brand check is realm-transparent and does not depend on the
 * `SilgiError` class reference being the exact same object across module
 * boundaries. It is also marginally faster than `instanceof` because it
 * skips the `[Symbol.hasInstance]` dispatch and reads the brand directly.
 *
 * @param e - Any value — typically a caught `unknown` error.
 * @returns `true` if `e` carries the `Symbol.for('silgi.error.brand.v1')` brand.
 *
 * @example
 * ```ts
 * catch (e) {
 *   if (isSilgiError(e)) {
 *     // e is SilgiError — access e.code, e.status, e.data safely
 *   }
 * }
 * ```
 *
 * @see {@link SilgiError}
 * @category Errors
 */
export function isSilgiError(e: unknown): e is SilgiError {
  return typeof e === 'object' && e !== null && (e as any)[BRAND] === true
}

/**
 * Returns `true` when `error` is a {@link SilgiError} that was explicitly
 * declared with `$errors()` (i.e. `defined === true`).
 *
 * @remarks
 * Defined errors are safe to expose verbatim to clients; undefined errors
 * should be redacted to a generic `INTERNAL_SERVER_ERROR` message.
 *
 * @param error - Any value.
 * @returns A type predicate narrowing to `TError & SilgiError & \{ defined: true \}`.
 *
 * @example
 * ```ts
 * if (isDefinedError(e)) {
 *   // e.defined === true — forward error details to the client
 * }
 * ```
 *
 * @see {@link isSilgiError}
 * @category Errors
 */
export function isDefinedError<TError>(error: TError): error is TError & SilgiError & { defined: true } {
  return isSilgiError(error) && error.defined === true
}

/**
 * Coerce any caught value into a {@link SilgiError}.
 *
 * @remarks
 * If `error` is already a `SilgiError` it is returned unchanged.
 * Any other value (plain `Error`, string, etc.) is wrapped in an
 * `INTERNAL_SERVER_ERROR` with the original value preserved as `cause`.
 * The wrapper message is intentionally generic to avoid leaking internal
 * details to clients.
 *
 * @param error - Any value — typically the argument of a `catch` block.
 * @returns The original `SilgiError`, or a new `SilgiError('INTERNAL_SERVER_ERROR')`.
 *
 * @example
 * ```ts
 * const e = toSilgiError(err)
 * res.status(e.status).json(e.toJSON())
 * ```
 *
 * @see {@link isSilgiError}
 * @category Errors
 */
export function toSilgiError(error: unknown): SilgiError {
  if (isSilgiError(error)) return error
  return new SilgiError('INTERNAL_SERVER_ERROR', {
    message: 'Internal server error',
    cause: error,
  })
}

/**
 * Returns `true` when `status` represents an HTTP error (4xx or 5xx).
 *
 * @param status - An HTTP status code.
 * @returns `true` when `status >= 400`.
 *
 * @example
 * ```ts
 * if (isErrorStatus(response.status)) handleError(response)
 * ```
 *
 * @category Errors
 */
export function isErrorStatus(status: number): boolean {
  return status >= 400
}

/**
 * Type guard that returns `true` when `json` has the shape of a
 * {@link SilgiErrorJSON} wire object.
 *
 * @param json - Any decoded JSON value.
 * @returns `true` when `json` has a string `code` and a numeric `status`.
 *
 * @example
 * ```ts
 * const body = await response.json()
 * if (isSilgiErrorJSON(body)) {
 *   throw fromSilgiErrorJSON(body)
 * }
 * ```
 *
 * @see {@link fromSilgiErrorJSON}
 * @category Errors
 */
export function isSilgiErrorJSON(json: unknown): json is SilgiErrorJSON {
  return (
    typeof json === 'object' &&
    json !== null &&
    'code' in json &&
    'status' in json &&
    typeof (json as SilgiErrorJSON).code === 'string'
  )
}

/**
 * Reconstruct a {@link SilgiError} from a {@link SilgiErrorJSON} wire object.
 *
 * @remarks
 * Typically used on the client side after receiving an error response.
 * The reconstructed error carries the brand and passes `isSilgiError()`.
 *
 * @param json - A validated {@link SilgiErrorJSON} object (use
 *   {@link isSilgiErrorJSON} to validate before calling this function).
 * @returns A fully-formed `SilgiError` instance.
 *
 * @example
 * ```ts
 * const body = await res.json()
 * if (isSilgiErrorJSON(body)) throw fromSilgiErrorJSON(body)
 * ```
 *
 * @see {@link isSilgiErrorJSON}
 * @category Errors
 */
export function fromSilgiErrorJSON(json: SilgiErrorJSON): SilgiError {
  return new SilgiError(json.code, {
    status: json.status,
    message: json.message,
    data: json.data,
    defined: json.defined,
  })
}

export { COMMON_ERRORS }
