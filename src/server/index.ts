// Server builder
export { Builder, ks } from "./builder.ts";
export type { BuilderConfig } from "./builder.ts";

// Procedure
export { Procedure, isProcedure } from "./procedure.ts";
export type { ProcedureDef, AnyProcedure } from "./procedure.ts";

// Router
export type { Router, AnyRouter, RouterClient, InferRouterInitialContext } from "./router.ts";
export { traverseProcedures, createRouterClient } from "./router.ts";

// Implementer (contract-first)
export { implement } from "./implementer.ts";
export type { Implementer } from "./implementer.ts";

// Context
export type { MergedCurrentContext, MergedInitialContext } from "./context.ts";

// Error constructors
export { createErrorConstructorMap } from "./error.ts";
export type { ErrorConstructorMap } from "./error.ts";

// Lazy loading
export { lazy, isLazy, unlazy, getLazyMeta } from "./lazy.ts";
export type { Lazy, Lazyable, LazyMeta } from "./lazy.ts";

// Standard handler
export { StandardHandler } from "./adapters/standard/handler.ts";
export type { HandlerResult, StandardHandlerOptions, StandardHandlerPlugin } from "./adapters/standard/handler.ts";

// Codec
export { decodeRequest, encodeResponse, encodeErrorResponse } from "./adapters/standard/codec.ts";

// Matcher
export { RouteMatcher, flattenRouter } from "./adapters/standard/matcher.ts";
export type { MatchResult } from "./adapters/standard/matcher.ts";

// Re-exports from core
export { KatmanError, isDefinedError, toKatmanError } from "../core/error.ts";
export type { KatmanErrorCode, KatmanErrorOptions, KatmanErrorJSON } from "../core/error.ts";
export { type, validateSchema, ValidationError } from "../core/schema.ts";
export type { Schema, AnySchema, InferSchemaInput, InferSchemaOutput } from "../core/schema.ts";
export type { Context, HTTPMethod, HTTPPath, Promisable } from "../core/types.ts";
export type { Middleware, AnyMiddleware, Handler, MiddlewareOptions, MiddlewareResult } from "../core/pipeline.ts";

// Re-exports from contract
export type { ErrorMap, ErrorMapItem, MergedErrorMap, ErrorFromErrorMap } from "../contract/error.ts";
export type { Route, InputStructure, OutputStructure } from "../contract/route.ts";
export type { Meta } from "../contract/meta.ts";
export { ContractProcedure, isContractProcedure } from "../contract/procedure.ts";
export type { ContractRouter, AnyContractRouter } from "../contract/router.ts";

// SSE
export { iteratorToEventStream, eventStreamToIterator, withEventMeta, getEventMeta } from "../core/sse.ts";
export type { EventMeta, EventMessage } from "../core/sse.ts";
