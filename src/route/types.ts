/**
 * Katman Router — Type definitions.
 */

/** Matched route result */
export interface MatchedRoute<T = unknown> {
  data: T
  params?: Record<string, string>
}

/** Router node in the radix tree */
export interface RouteNode<T = unknown> {
  /** Segment key (e.g. 'users', '*', '**') */
  key: string
  /** Static children indexed by segment */
  static?: Record<string, RouteNode<T>>
  /** Dynamic param child (`:param`) */
  param?: RouteNode<T>
  /** Wildcard child (`**`) */
  wildcard?: RouteNode<T>
  /** Whether this node has regex-constrained params */
  hasRegex?: boolean
  /** Method → handler data. Empty string = any method */
  methods?: Record<string, MethodEntry<T>[]>
}

/** Single method entry with data and param extraction info */
export interface MethodEntry<T = unknown> {
  data: T
  /** Param name/index mapping: [segmentIndex, paramName, optional] */
  paramMap?: ParamMapEntry[]
  /** Regex constraints per segment index */
  paramRegex: RegExp[]
  /** Whether this entry ends with a catch-all (**, **:name, :name+, :name*) */
  catchAll?: boolean
}

/** [segmentIndex, paramName, isOptional] */
export type ParamMapEntry = [index: number, name: string | RegExp, optional: boolean]

/** Router context — holds the tree and static cache */
export interface RouterContext<T = unknown> {
  root: RouteNode<T>
  /** Fast path: exact static routes bypass tree traversal */
  static: Record<string, RouteNode<T> | undefined>
}
