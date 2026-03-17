/**
 * Katman — The fastest end-to-end type-safe RPC framework.
 *
 * Usage:
 *   import { ks, kc, createClient, implement, KatmanError } from "katman"
 *
 * Adapters:
 *   import { RPCHandler } from "katman/node"
 *   import { RPCHandler } from "katman/fetch"
 *   import { WebSocketHandler } from "katman/websocket"
 *
 * Client:
 *   import { RPCLink } from "katman/client/fetch"
 *   import { withRetry, withDedupe, withCSRF, BatchLink } from "katman/client/plugins"
 *
 * Plugins:
 *   import { CORSPlugin, CSRFPlugin, BatchPlugin } from "katman/plugins"
 *   import { OTelPlugin } from "katman/otel"
 *   import { LoggingPlugin } from "katman/pino"
 *   import { createRateLimitMiddleware } from "katman/ratelimit"
 *
 * OpenAPI:
 *   import { OpenAPIGenerator } from "katman/openapi"
 *
 * Integrations:
 *   import { ZodSchemaConverter } from "katman/zod"
 *   import { createQueryUtils } from "katman/tanstack-query"
 *   import { createActionableClient, createFormAction } from "katman/react"
 */

// Server builder
export { ks } from "./server/builder.ts";
export { Builder } from "./server/builder.ts";

// Contract builder
export { kc } from "./contract/builder.ts";
export { ContractBuilder } from "./contract/builder.ts";

// Contract-first implementation
export { implement } from "./server/implementer.ts";

// Client
export { createClient, safe } from "./client/client.ts";

// Core error
export { KatmanError, isDefinedError, toKatmanError } from "./core/error.ts";

// Schema
export { type, validateSchema, ValidationError } from "./core/schema.ts";

// SSE
export { withEventMeta, getEventMeta } from "./core/sse.ts";

// Lazy loading
export { lazy } from "./server/lazy.ts";

// Types
export type { Context, HTTPMethod, HTTPPath } from "./core/types.ts";
export type { Schema, AnySchema, InferSchemaInput, InferSchemaOutput } from "./core/schema.ts";
export type { Router, AnyRouter, RouterClient } from "./server/router.ts";
export type { Client, NestedClient, ClientLink, ClientContext } from "./client/types.ts";
export type { ErrorMap, ErrorMapItem } from "./contract/error.ts";
export type { Route, Meta } from "./contract/index.ts";
export type { Middleware, AnyMiddleware, Handler } from "./core/pipeline.ts";
export type { EventMeta } from "./core/sse.ts";
export type { Lazy, Lazyable } from "./server/lazy.ts";
