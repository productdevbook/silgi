/**
 * Deno compatibility smoke test.
 *
 * Run: deno run --allow-net --allow-read test/deno-compat.ts
 */

import { katman } from "../src/katman.ts";
// @ts-ignore — Deno uses npm: specifier for npm packages
import { z } from "zod";

const k = katman({ context: () => ({ db: true }) });

const router = k.router({
  health: k.query(() => ({ status: "ok", runtime: "deno" })),
  echo: k.query(z.object({ msg: z.string() }), ({ input }) => ({ echo: input.msg })),
});

const handle = k.handler(router);

// Test 1: No-input query
const r1 = await handle(new Request("http://localhost/health", { method: "POST" }));
const d1 = await r1.json();
console.assert(d1.status === "ok", `FAIL: health status = ${d1.status}`);
console.log(`✓ health: ${JSON.stringify(d1)}`);

// Test 2: Query with input
const r2 = await handle(new Request("http://localhost/echo", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ msg: "hello deno" }),
}));
const d2 = await r2.json();
console.assert(d2.echo === "hello deno", `FAIL: echo = ${d2.echo}`);
console.log(`✓ echo: ${JSON.stringify(d2)}`);

// Test 3: 404
const r3 = await handle(new Request("http://localhost/nope", { method: "POST" }));
console.assert(r3.status === 404, `FAIL: status = ${r3.status}`);
console.log(`✓ 404: status=${r3.status}`);

console.log(`\n✅ All Deno compatibility tests passed`);
