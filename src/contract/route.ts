/**
 * Route metadata — HTTP binding and OpenAPI annotations.
 */

import type { HTTPMethod, HTTPPath } from "../core/types.ts";

export type InputStructure = "compact" | "detailed";
export type OutputStructure = "compact" | "detailed";

export interface Route {
  method?: HTTPMethod;
  path?: HTTPPath;
  summary?: string;
  description?: string;
  deprecated?: boolean;
  tags?: string[];
  successStatus?: number;
  successDescription?: string;
  inputStructure?: InputStructure;
  outputStructure?: OutputStructure;
}

export interface EnhanceRouteOptions {
  prefix?: string;
  tags?: string[];
}

export function mergeRoute(a: Route, b: Route): Route {
  return { ...a, ...b };
}

export function prefixRoute(route: Route, prefix: string): Route {
  if (!route.path) return { ...route, path: prefix as HTTPPath };
  return { ...route, path: `${prefix}${route.path}` as HTTPPath };
}

export function prependTags(route: Route, tags: string[]): Route {
  if (tags.length === 0) return route;
  return { ...route, tags: [...tags, ...(route.tags ?? [])] };
}

export function enhanceRoute(route: Route, options: EnhanceRouteOptions): Route {
  let enhanced = route;
  if (options.prefix) enhanced = prefixRoute(enhanced, options.prefix);
  if (options.tags) enhanced = prependTags(enhanced, options.tags);
  return enhanced;
}

export function mergePrefix(a: string | undefined, b: string | undefined): string | undefined {
  if (!a && !b) return undefined;
  return `${a ?? ""}${b ?? ""}`;
}

export function mergeTags(a: string[] | undefined, b: string[] | undefined): string[] | undefined {
  if (!a && !b) return undefined;
  return [...(a ?? []), ...(b ?? [])];
}
