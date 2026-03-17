/**
 * Proxy utilities — cached path builder (Katman's client innovation).
 *
 * oRPC: new Proxy per property access → O(n) allocations for n-deep paths
 * Katman: Map-cached sub-proxies → O(1) on repeated access
 */

export function preventNativeAwait<T extends object>(target: T): T {
  return new Proxy(target, {
    get(t, prop, receiver) {
      if (prop === "then") return undefined;
      return Reflect.get(t, prop, receiver);
    },
  });
}

export function overlayProxy<TBase extends object, TOverlay extends object>(
  base: TBase,
  overlay: TOverlay,
): TBase & TOverlay {
  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop in overlay) {
        const val = Reflect.get(overlay, prop, overlay);
        return typeof val === "function" ? val.bind(overlay) : val;
      }
      const val = Reflect.get(target, prop, receiver);
      return typeof val === "function" ? val.bind(target) : val;
    },
    has(target, prop) {
      return prop in overlay || prop in target;
    },
  }) as TBase & TOverlay;
}

/**
 * Create a cached recursive proxy for nested path access.
 * Sub-proxies are cached in a Map — repeated `.users.list` returns same object.
 */
export function createCachedProxy<T>(
  callHandler: (path: readonly string[], args: unknown[]) => unknown,
  path: readonly string[] = [],
): T {
  const cache = new Map<string, unknown>();

  const callable = (...args: unknown[]) => callHandler(path, args);

  return new Proxy(callable, {
    get(_target, prop) {
      if (prop === "then") return undefined;
      if (typeof prop !== "string") return Reflect.get(callable, prop);

      let cached = cache.get(prop);
      if (!cached) {
        cached = createCachedProxy(callHandler, [...path, prop]);
        cache.set(prop, cached);
      }
      return cached;
    },
    apply(_target, _thisArg, args) {
      return callHandler(path, args);
    },
  }) as T;
}
