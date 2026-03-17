/**
 * Micro-benchmark: isolate individual overhead sources
 */
import { bench, run, summary } from "mitata";

// Test 1: new URL() vs manual pathname extraction
const testUrl = "http://localhost:3000/users/list?limit=10";

summary(() => {
  bench("new URL(url).pathname", () => {
    const pathname = new URL(testUrl).pathname;
  });

  bench("manual pathname extract", () => {
    const s = testUrl;
    const i = s.indexOf("/", s.indexOf("//") + 2);
    const j = s.indexOf("?", i);
    const pathname = j === -1 ? s.slice(i) : s.slice(i, j);
  });
});

// Test 2: Map.get with slash prefix vs without
const mapWithSlash = new Map([
  ["/users/list", 1], ["/users/create", 2], ["/health", 3],
]);
const mapWithout = new Map([
  ["users/list", 1], ["users/create", 2], ["health", 3],
]);

summary(() => {
  bench("Map.get (key with /)", () => {
    mapWithSlash.get("/users/list");
  });

  bench("Map.get (key without /, + slice)", () => {
    const key = "/users/list".slice(1);
    mapWithout.get(key);
  });
});

// Test 3: Object.assign vs direct property set
const sourceObj = { user: { id: 1 }, permissions: ["read"] };

summary(() => {
  bench("Object.assign(ctx, result)", () => {
    const ctx: Record<string, unknown> = {};
    Object.assign(ctx, sourceObj);
  });

  bench("direct property set", () => {
    const ctx: Record<string, unknown> = {};
    ctx.user = sourceObj.user;
    ctx.permissions = sourceObj.permissions;
  });
});

// Test 4: async function overhead
const syncFn = (x: number) => x * 2;
const asyncFn = async (x: number) => x * 2;

summary(() => {
  bench("sync function call", () => {
    syncFn(42);
  });

  bench("await async function call", async () => {
    await asyncFn(42);
  });
});

// Test 5: { input, ctx, fail, signal } allocation
const fail = () => { throw new Error(); };
const signal = AbortSignal.timeout(30000);

summary(() => {
  bench("create options object", () => {
    const opts = { input: { name: "Alice" }, ctx: {}, fail, signal };
  });

  bench("reuse pre-allocated options", () => {
    const opts = preallocatedOpts;
    opts.input = { name: "Alice" };
    opts.ctx = {};
  });
});
const preallocatedOpts: any = { input: null, ctx: null, fail, signal };

// Test 6: request.json() vs request.text() + JSON.parse
summary(() => {
  bench("new Request + .text() + JSON.parse", async () => {
    const req = new Request("http://localhost/test", {
      method: "POST", body: '{"name":"Alice","age":30}',
      headers: { "content-type": "application/json" },
    });
    JSON.parse(await req.text());
  });

  bench("new Request + .json()", async () => {
    const req = new Request("http://localhost/test", {
      method: "POST", body: '{"name":"Alice","age":30}',
      headers: { "content-type": "application/json" },
    });
    await req.json();
  });
});

await run();
