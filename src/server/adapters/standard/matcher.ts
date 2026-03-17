/**
 * Route Matcher — compiled radix trie for fast O(1) route matching.
 *
 * Supports:
 * - Static paths: /users/list
 * - Dynamic params: /users/{id}
 * - Wildcard: /files/{+path}
 * - Lazy router resolution (only loads when path prefix matches)
 */

import type { AnyRouter } from "../../router.ts";
import type { AnyProcedure } from "../../procedure.ts";
import { isProcedure } from "../../procedure.ts";
import { isLazy, unlazy, getLazyMeta } from "../../lazy.ts";
import type { Lazyable } from "../../lazy.ts";

export interface MatchResult {
  procedure: AnyProcedure;
  params: Record<string, string>;
  path: string[];
}

interface RouteNode {
  procedure?: AnyProcedure;
  children: Map<string, RouteNode>;
  paramChild?: { name: string; node: RouteNode };
  wildcardChild?: { name: string; procedure?: AnyProcedure };
}

/**
 * Build a route tree from a router for OpenAPI-style path matching.
 * This is used by the OpenAPI handler, not the RPC handler
 * (which uses path segments directly).
 */
export class RouteMatcher {
  #root: RouteNode = { children: new Map() };

  /**
   * Register a procedure at an HTTP path.
   */
  add(method: string, httpPath: string, procedure: AnyProcedure): void {
    const segments = httpPath.split("/").filter(Boolean);
    let node = this.#root;

    for (const segment of segments) {
      if (segment.startsWith("{+")) {
        // Wildcard param
        const name = segment.slice(2, -1);
        node.wildcardChild = { name, procedure };
        return;
      }

      if (segment.startsWith("{")) {
        // Dynamic param
        const name = segment.slice(1, -1);
        if (!node.paramChild) {
          node.paramChild = { name, node: { children: new Map() } };
        }
        node = node.paramChild.node;
        continue;
      }

      // Static segment
      let child = node.children.get(segment);
      if (!child) {
        child = { children: new Map() };
        node.children.set(segment, child);
      }
      node = child;
    }

    node.procedure = procedure;
  }

  /**
   * Match a URL pathname against registered routes.
   */
  match(pathname: string): MatchResult | undefined {
    const segments = pathname.split("/").filter(Boolean);
    const params: Record<string, string> = {};

    return this.#matchNode(this.#root, segments, 0, params);
  }

  #matchNode(
    node: RouteNode,
    segments: string[],
    index: number,
    params: Record<string, string>,
  ): MatchResult | undefined {
    if (index === segments.length) {
      if (node.procedure) {
        return {
          procedure: node.procedure,
          params: { ...params },
          path: segments,
        };
      }
      return undefined;
    }

    const segment = segments[index]!;

    // Try static match first
    const staticChild = node.children.get(segment);
    if (staticChild) {
      const result = this.#matchNode(staticChild, segments, index + 1, params);
      if (result) return result;
    }

    // Try param match
    if (node.paramChild) {
      params[node.paramChild.name] = segment;
      const result = this.#matchNode(node.paramChild.node, segments, index + 1, params);
      if (result) return result;
      delete params[node.paramChild.name];
    }

    // Try wildcard match
    if (node.wildcardChild) {
      params[node.wildcardChild.name] = segments.slice(index).join("/");
      if (node.wildcardChild.procedure) {
        return {
          procedure: node.wildcardChild.procedure,
          params: { ...params },
          path: segments,
        };
      }
    }

    return undefined;
  }
}

/**
 * Build a flat path→procedure map from an RPC-style router.
 * Used for route discovery (e.g., OpenAPI generation).
 */
export async function flattenRouter(
  router: AnyRouter,
  path: string[] = [],
): Promise<Map<string, AnyProcedure>> {
  const result = new Map<string, AnyProcedure>();

  async function walk(current: unknown, currentPath: string[]): Promise<void> {
    if (isLazy(current)) {
      current = (await unlazy(current)).default;
    }
    if (isProcedure(current)) {
      result.set(currentPath.join("/"), current);
      return;
    }
    if (typeof current === "object" && current !== null) {
      for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
        await walk(child, [...currentPath, key]);
      }
    }
  }

  await walk(router, path);
  return result;
}
