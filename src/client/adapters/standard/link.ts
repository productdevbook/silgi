/**
 * Standard link — transport-agnostic codec + interceptor orchestration.
 */

import type { ClientLink, ClientContext, ClientOptions } from "../../types.ts";
import type { StandardLazyRequest, StandardLazyResponse, Promisable } from "../../../core/types.ts";
import type { Interceptor } from "../../../core/interceptor.ts";
import { intercept } from "../../../core/interceptor.ts";

export interface StandardLinkCodec<TClientContext extends ClientContext> {
  encode(
    path: readonly string[],
    input: unknown,
    options: ClientOptions<TClientContext>,
  ): Promisable<{ url: URL; method: string; headers: Record<string, string>; body: unknown }>;

  decode(
    response: StandardLazyResponse,
    options: ClientOptions<TClientContext>,
    path: readonly string[],
  ): Promisable<unknown>;
}

export interface StandardLinkClient<TClientContext extends ClientContext> {
  call(
    request: { url: URL; method: string; headers: Record<string, string>; body: unknown },
    options: ClientOptions<TClientContext>,
  ): Promise<StandardLazyResponse>;
}

export interface StandardLinkOptions<TClientContext extends ClientContext> {
  codec: StandardLinkCodec<TClientContext>;
  sender: StandardLinkClient<TClientContext>;
  interceptors?: Interceptor<unknown>[];
  clientInterceptors?: Interceptor<unknown>[];
}

export class StandardLink<TClientContext extends ClientContext = ClientContext>
  implements ClientLink<TClientContext>
{
  #codec: StandardLinkCodec<TClientContext>;
  #sender: StandardLinkClient<TClientContext>;

  constructor(options: StandardLinkOptions<TClientContext>) {
    this.#codec = options.codec;
    this.#sender = options.sender;
  }

  async call(
    path: readonly string[],
    input: unknown,
    options: ClientOptions<TClientContext>,
  ): Promise<unknown> {
    // Encode
    const request = await this.#codec.encode(path, input, options);

    // Send
    const response = await this.#sender.call(request, options);

    // Decode
    return this.#codec.decode(response, options, path);
  }
}
