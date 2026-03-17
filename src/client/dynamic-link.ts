/**
 * Dynamic link — resolves the target link per request.
 */

import type { ClientLink, ClientContext, ClientOptions } from "./types.ts";
import type { Promisable } from "../core/types.ts";

export type LinkResolver<TClientContext extends ClientContext> = (
  path: readonly string[],
  input: unknown,
  options: ClientOptions<TClientContext>,
) => Promisable<ClientLink<TClientContext>>;

export class DynamicLink<TClientContext extends ClientContext = ClientContext>
  implements ClientLink<TClientContext>
{
  #resolver: LinkResolver<TClientContext>;

  constructor(resolver: LinkResolver<TClientContext>) {
    this.#resolver = resolver;
  }

  async call(
    path: readonly string[],
    input: unknown,
    options: ClientOptions<TClientContext>,
  ): Promise<unknown> {
    const link = await this.#resolver(path, input, options);
    return link.call(path, input, options);
  }
}
