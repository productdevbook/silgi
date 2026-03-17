/**
 * Meta type — extensible metadata for procedures.
 */

export type Meta = Record<string, unknown>;

export function mergeMeta<T1 extends Meta, T2 extends Meta>(a: T1, b: T2): T1 & T2 {
  return { ...a, ...b } as T1 & T2;
}
