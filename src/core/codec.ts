/**
 * JSON Serializer with native type support.
 * Handles BigInt, Date, NaN, undefined, URL, RegExp, Set, Map, Blob/File.
 */

export const TypeCode = {
  BigInt: 0,
  Date: 1,
  NaN: 2,
  Undefined: 3,
  URL: 4,
  RegExp: 5,
  Set: 6,
  Map: 7,
} as const;

export type SerializedMeta = [type: number, ...path: (string | number)[]];

export interface SerializeResult {
  json: unknown;
  meta: SerializedMeta[];
  maps: (string | number)[][];
  blobs: Blob[];
}

export class JsonSerializer {
  serialize(value: unknown): SerializeResult {
    const meta: SerializedMeta[] = [];
    const maps: (string | number)[][] = [];
    const blobs: Blob[] = [];
    const json = this.#walk(value, [], meta, maps, blobs);
    return { json, meta, maps, blobs };
  }

  deserialize(json: unknown, meta: SerializedMeta[]): unknown {
    // Wrap in a container so we can handle root-level type changes
    const container: any = { "": typeof json === "object" && json !== null
      ? JSON.parse(JSON.stringify(json))
      : json };
    for (const [type, ...path] of meta) {
      const fullPath = ["", ...path];
      let parent: any = container;
      for (let i = 0; i < fullPath.length - 1; i++) {
        const key = fullPath[i]!;
        if (parent == null || !Object.hasOwn(parent, key)) { parent = null; break; }
        parent = parent[key];
      }
      if (parent == null) continue;
      const lastKey = fullPath[fullPath.length - 1]!;
      if (!Object.hasOwn(parent, lastKey)) continue;
      const raw = parent[lastKey];
      switch (type) {
        case TypeCode.BigInt: parent[lastKey] = BigInt(raw); break;
        case TypeCode.Date: parent[lastKey] = new Date(raw as string); break;
        case TypeCode.NaN: parent[lastKey] = Number.NaN; break;
        case TypeCode.Undefined: parent[lastKey] = undefined; break;
        case TypeCode.URL: parent[lastKey] = new URL(raw as string); break;
        case TypeCode.RegExp: {
          const s = raw as string;
          const i = s.lastIndexOf("/");
          parent[lastKey] = new RegExp(s.slice(1, i), s.slice(i + 1));
          break;
        }
        case TypeCode.Set: parent[lastKey] = new Set(raw as unknown[]); break;
        case TypeCode.Map: parent[lastKey] = new Map(raw as [unknown, unknown][]); break;
      }
    }
    return container[""];
  }

  #walk(
    value: unknown,
    path: (string | number)[],
    meta: SerializedMeta[],
    maps: (string | number)[][],
    blobs: Blob[],
  ): unknown {
    if (value === undefined) {
      meta.push([TypeCode.Undefined, ...path]);
      return null;
    }
    if (value === null) return null;
    if (typeof value === "bigint") {
      meta.push([TypeCode.BigInt, ...path]);
      return value.toString();
    }
    if (typeof value === "number") {
      if (Number.isNaN(value)) {
        meta.push([TypeCode.NaN, ...path]);
        return "NaN";
      }
      return value;
    }
    if (typeof value === "string" || typeof value === "boolean") return value;
    if (value instanceof Date) {
      meta.push([TypeCode.Date, ...path]);
      return value.toISOString();
    }
    if (value instanceof URL) {
      meta.push([TypeCode.URL, ...path]);
      return value.href;
    }
    if (value instanceof RegExp) {
      meta.push([TypeCode.RegExp, ...path]);
      return value.toString();
    }
    if (value instanceof Set) {
      meta.push([TypeCode.Set, ...path]);
      return [...value].map((item, i) => this.#walk(item, [...path, i], meta, maps, blobs));
    }
    if (value instanceof Map) {
      meta.push([TypeCode.Map, ...path]);
      let i = 0;
      return [...value.entries()].map(([k, v]) => {
        const entry = [
          this.#walk(k, [...path, i, 0], meta, maps, blobs),
          this.#walk(v, [...path, i, 1], meta, maps, blobs),
        ];
        i++;
        return entry;
      });
    }
    if (value instanceof Blob) {
      maps.push([...path]);
      blobs.push(value);
      return null;
    }
    if (Array.isArray(value)) {
      return value.map((item, i) => this.#walk(item, [...path, i], meta, maps, blobs));
    }
    if (typeof value === "object") {
      const result: Record<string, unknown> = {};
      for (const key of Object.keys(value as object)) {
        result[key] = this.#walk((value as any)[key], [...path, key], meta, maps, blobs);
      }
      return result;
    }
    return value;
  }
}
