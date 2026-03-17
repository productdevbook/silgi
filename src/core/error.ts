/**
 * KatmanError — unified RPC error with cross-realm instanceof.
 */

const COMMON_ERRORS = /* @__PURE__ */ Object.freeze({
  BAD_REQUEST: { status: 400, message: "Bad Request" },
  UNAUTHORIZED: { status: 401, message: "Unauthorized" },
  FORBIDDEN: { status: 403, message: "Forbidden" },
  NOT_FOUND: { status: 404, message: "Not Found" },
  METHOD_NOT_ALLOWED: { status: 405, message: "Method Not Allowed" },
  NOT_ACCEPTABLE: { status: 406, message: "Not Acceptable" },
  CONFLICT: { status: 409, message: "Conflict" },
  GONE: { status: 410, message: "Gone" },
  UNPROCESSABLE_CONTENT: { status: 422, message: "Unprocessable Content" },
  PRECONDITION_REQUIRED: { status: 428, message: "Precondition Required" },
  TOO_MANY_REQUESTS: { status: 429, message: "Too Many Requests" },
  CLIENT_CLOSED_REQUEST: { status: 499, message: "Client Closed Request" },
  INTERNAL_SERVER_ERROR: { status: 500, message: "Internal Server Error" },
  NOT_IMPLEMENTED: { status: 501, message: "Not Implemented" },
  BAD_GATEWAY: { status: 502, message: "Bad Gateway" },
  SERVICE_UNAVAILABLE: { status: 503, message: "Service Unavailable" },
  GATEWAY_TIMEOUT: { status: 504, message: "Gateway Timeout" },
} as const);

export type KatmanErrorCode = keyof typeof COMMON_ERRORS | (string & {});

export interface KatmanErrorOptions<TData = unknown> {
  status?: number;
  message?: string;
  data?: TData;
  cause?: unknown;
  defined?: boolean;
}

export interface KatmanErrorJSON<TCode extends string = string, TData = unknown> {
  defined: boolean;
  code: TCode;
  status: number;
  message: string;
  data: TData;
}

const REGISTRY_KEY = Symbol.for("katman.error.registry");
const registry =
  ((globalThis as Record<symbol, WeakSet<Function>>)[REGISTRY_KEY] ??=
    new WeakSet<Function>());

export class KatmanError<
  TCode extends string = string,
  TData = unknown,
> extends Error {
  readonly code: TCode;
  readonly status: number;
  readonly data: TData;
  readonly defined: boolean;

  constructor(code: TCode, options: KatmanErrorOptions<TData> = {}) {
    const defaults = COMMON_ERRORS[code as keyof typeof COMMON_ERRORS];
    const message = options.message ?? defaults?.message ?? code;
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.code = code;
    this.status = options.status ?? defaults?.status ?? 500;
    this.data = options.data as TData;
    this.defined = options.defined ?? false;
    this.name = "KatmanError";
  }

  toJSON(): KatmanErrorJSON<TCode, TData> {
    return {
      defined: this.defined,
      code: this.code,
      status: this.status,
      message: this.message,
      data: this.data,
    };
  }

  static {
    registry.add(this);
  }

  static [Symbol.hasInstance](instance: unknown): boolean {
    if (typeof instance !== "object" || instance === null) return false;
    let proto = Object.getPrototypeOf(instance);
    while (proto) {
      if (proto.constructor && registry.has(proto.constructor)) return true;
      proto = Object.getPrototypeOf(proto);
    }
    return false;
  }
}

export function isDefinedError<TError>(
  error: TError,
): error is TError & KatmanError & { defined: true } {
  return error instanceof KatmanError && error.defined === true;
}

export function toKatmanError(error: unknown): KatmanError {
  if (error instanceof KatmanError) return error;
  return new KatmanError("INTERNAL_SERVER_ERROR", {
    message: error instanceof Error ? error.message : "Unknown error",
    cause: error,
  });
}

export function isErrorStatus(status: number): boolean {
  return status >= 400;
}

export function isKatmanErrorJSON(json: unknown): json is KatmanErrorJSON {
  return (
    typeof json === "object" &&
    json !== null &&
    "code" in json &&
    "status" in json &&
    typeof (json as KatmanErrorJSON).code === "string"
  );
}

export function fromKatmanErrorJSON(json: KatmanErrorJSON): KatmanError {
  return new KatmanError(json.code, {
    status: json.status,
    message: json.message,
    data: json.data,
    defined: json.defined,
  });
}
