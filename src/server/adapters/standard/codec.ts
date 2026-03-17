/**
 * RPC Codec — proper serialization with type metadata.
 *
 * Encodes responses as { json, meta } so the client can
 * reconstruct native types (Date, BigInt, Set, Map, etc.).
 *
 * Decodes requests from:
 * - POST body: { json, meta } or plain JSON
 * - GET query: ?data={json,meta} (URL-encoded)
 * - POST FormData: data field + blob fields
 */

import type { StandardLazyRequest, StandardResponse, StandardBody } from "../../../core/types.ts";
import type { AnyProcedure } from "../../procedure.ts";
import { JsonSerializer } from "../../../core/codec.ts";
import { KatmanError } from "../../../core/error.ts";
import { parseEmptyableJSON, stringifyJSON } from "../../../core/utils.ts";

const serializer = new JsonSerializer();

export interface DecodeResult {
  input: unknown;
}

/**
 * Decode input from a standard request.
 */
export async function decodeRequest(
  request: StandardLazyRequest,
): Promise<unknown> {
  const method = request.method.toUpperCase();

  // GET: input in query string
  if (method === "GET") {
    const dataParam = request.url.searchParams.get("data");
    if (!dataParam) return undefined;
    try {
      const { json, meta } = JSON.parse(dataParam) as { json: unknown; meta: unknown[] };
      return meta?.length ? serializer.deserialize(json, meta as any) : json;
    } catch {
      return parseEmptyableJSON(dataParam);
    }
  }

  // POST/PUT/PATCH/DELETE: input in body
  const body = await request.body();
  if (body === undefined || body === null) return undefined;

  // FormData with blobs
  if (body instanceof FormData) {
    const dataStr = body.get("data");
    if (typeof dataStr !== "string") return undefined;
    const { json, meta, maps } = JSON.parse(dataStr) as {
      json: unknown;
      meta: unknown[];
      maps: (string | number)[][];
    };
    let result = meta?.length ? serializer.deserialize(json, meta as any) : json;
    // Restore blobs
    if (maps?.length) {
      for (let i = 0; i < maps.length; i++) {
        const path = maps[i]!;
        const blob = body.get(String(i));
        if (blob) setNestedValue(result, path, blob);
      }
    }
    return result;
  }

  // URLSearchParams
  if (body instanceof URLSearchParams) {
    const dataParam = body.get("data");
    if (!dataParam) return undefined;
    const parsed = JSON.parse(dataParam);
    if (parsed.meta?.length) return serializer.deserialize(parsed.json, parsed.meta);
    return parsed.json ?? parsed;
  }

  // Plain object — check if it's the { json, meta } envelope
  if (typeof body === "object" && body !== null && "json" in body && "meta" in body) {
    const { json, meta } = body as { json: unknown; meta: unknown[] };
    return meta?.length ? serializer.deserialize(json, meta as any) : json;
  }

  // Raw value
  return body;
}

/**
 * Encode output as a standard response with type metadata.
 */
export function encodeResponse(
  output: unknown,
  procedure: AnyProcedure,
): StandardResponse {
  const { json, meta, maps, blobs } = serializer.serialize(output);

  // If there are blobs, we'd use FormData — but for simplicity,
  // skip blobs in response (they're typically only in requests)
  const body = { json, meta };
  const status = procedure["~katman"].route.successStatus ?? 200;

  return {
    status,
    headers: { "content-type": "application/json" },
    body,
  };
}

/**
 * Encode an error as a standard response.
 */
export function encodeErrorResponse(error: KatmanError): StandardResponse {
  return {
    status: error.status,
    headers: { "content-type": "application/json" },
    body: error.toJSON(),
  };
}

function setNestedValue(obj: any, path: (string | number)[], value: unknown): void {
  let current = obj;
  for (let i = 0; i < path.length - 1; i++) {
    current = current[path[i]!];
    if (current == null) return;
  }
  const lastKey = path[path.length - 1];
  if (lastKey !== undefined) current[lastKey] = value;
}
