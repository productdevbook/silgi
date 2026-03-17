/**
 * Fetch transport — HTTP client for browser and Node.js.
 */

import type { ClientLink, ClientContext, ClientOptions } from "../../types.ts";
import type { StandardLazyResponse } from "../../../core/types.ts";
import { KatmanError, isKatmanErrorJSON, fromKatmanErrorJSON, isErrorStatus } from "../../../core/error.ts";
import { stringifyJSON, parseEmptyableJSON, once } from "../../../core/utils.ts";
import { JsonSerializer } from "../../../core/codec.ts";

export interface RPCLinkOptions<TClientContext extends ClientContext = ClientContext> {
  url: string | URL;
  headers?: Record<string, string> | ((options: ClientOptions<TClientContext>) => Record<string, string>);
  fetch?: typeof globalThis.fetch;
  method?: "GET" | "POST";
  maxUrlLength?: number;
}

export class RPCLink<TClientContext extends ClientContext = ClientContext>
  implements ClientLink<TClientContext>
{
  #baseUrl: string;
  #headers: RPCLinkOptions<TClientContext>["headers"];
  #fetch: typeof globalThis.fetch;
  #method: "GET" | "POST";
  #maxUrlLength: number;
  #serializer = new JsonSerializer();

  constructor(options: RPCLinkOptions<TClientContext>) {
    this.#baseUrl = typeof options.url === "string" ? options.url : options.url.href;
    if (this.#baseUrl.endsWith("/")) {
      this.#baseUrl = this.#baseUrl.slice(0, -1);
    }
    this.#headers = options.headers;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#method = options.method ?? "POST";
    this.#maxUrlLength = options.maxUrlLength ?? 2083;
  }

  async call(
    path: readonly string[],
    input: unknown,
    options: ClientOptions<TClientContext>,
  ): Promise<unknown> {
    // Build URL
    const urlPath = path.map(encodeURIComponent).join("/");
    let url = `${this.#baseUrl}/${urlPath}`;

    // Resolve headers
    const headers: Record<string, string> = {
      ...(typeof this.#headers === "function"
        ? this.#headers(options)
        : this.#headers),
    };

    // Serialize input
    const { json, meta, maps, blobs } = this.#serializer.serialize(input);

    let method = this.#method;
    let body: BodyInit | undefined;

    if (method === "GET" && blobs.length === 0) {
      // Try to put input in query string
      const data = stringifyJSON({ json, meta });
      const candidateUrl = `${url}?data=${encodeURIComponent(data)}`;
      if (candidateUrl.length <= this.#maxUrlLength) {
        url = candidateUrl;
        body = undefined;
      } else {
        // Fall back to POST
        method = "POST";
        headers["content-type"] = "application/json";
        body = stringifyJSON({ json, meta });
      }
    } else if (blobs.length > 0) {
      // Use FormData for blobs
      method = "POST";
      const formData = new FormData();
      formData.set("data", stringifyJSON({ json, meta, maps }));
      blobs.forEach((blob, i) => formData.set(String(i), blob));
      body = formData;
    } else {
      headers["content-type"] = "application/json";
      body = stringifyJSON({ json, meta });
    }

    // Send request
    const response = await this.#fetch(url, {
      method,
      headers,
      body,
      signal: options.signal,
      redirect: "manual",
    });

    // Decode response
    const responseText = await response.text();
    const responseBody = responseText ? parseEmptyableJSON(responseText) : undefined;

    if (isErrorStatus(response.status)) {
      if (isKatmanErrorJSON(responseBody)) {
        throw fromKatmanErrorJSON(responseBody);
      }
      throw new KatmanError("INTERNAL_SERVER_ERROR", {
        status: response.status,
        message: `HTTP ${response.status}`,
        data: responseBody,
      });
    }

    // Deserialize with meta
    if (
      typeof responseBody === "object" &&
      responseBody !== null &&
      "json" in responseBody &&
      "meta" in responseBody
    ) {
      const { json: rJson, meta: rMeta } = responseBody as { json: unknown; meta: any[] };
      return this.#serializer.deserialize(rJson, rMeta);
    }

    return responseBody;
  }
}
