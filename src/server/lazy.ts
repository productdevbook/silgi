/**
 * Lazy loading for routers — enables code splitting.
 */

const LAZY_SYMBOL: unique symbol = Symbol("KATMAN_LAZY");

export interface Lazy<T> {
  [LAZY_SYMBOL]: {
    loader: () => Promise<{ default: T }>;
    meta: LazyMeta;
  };
}

export interface LazyMeta {
  prefix?: string;
}

export type Lazyable<T> = T | Lazy<T>;

export function lazy<T>(
  loader: () => Promise<{ default: T }>,
  meta: LazyMeta = {},
): Lazy<T> {
  return { [LAZY_SYMBOL]: { loader, meta } };
}

export function isLazy<T>(value: Lazyable<T>): value is Lazy<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    LAZY_SYMBOL in value
  );
}

export async function unlazy<T>(value: Lazyable<T>): Promise<{ default: T }> {
  if (isLazy(value)) {
    return value[LAZY_SYMBOL].loader();
  }
  return { default: value };
}

export function getLazyMeta<T>(value: Lazy<T>): LazyMeta {
  return value[LAZY_SYMBOL].meta;
}
