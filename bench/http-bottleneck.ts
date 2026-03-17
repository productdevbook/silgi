/**
 * HTTP hot-path bottleneck analysis
 * Per-request allocation/overhead measurements
 */
import { bench, run, summary } from "mitata";

// 1. AbortSignal.timeout() — created EVERY request
summary(() => {
  bench("AbortSignal.timeout(30_000)", () => {
    AbortSignal.timeout(30_000);
  });

  const shared = new AbortController().signal;
  bench("shared signal (reuse)", () => {
    const s = shared; // just reference
  });
});

// 2. Body reading strategies
const smallBody = '{"name":"Alice","age":30}';
const buf = Buffer.from(smallBody);

summary(() => {
  bench("Buffer[] + concat + toString", () => {
    const chunks: Buffer[] = [buf];
    Buffer.concat(chunks).toString();
  });

  bench("direct string accumulation", () => {
    let s = "";
    s += buf.toString();
  });

  bench("buf.toString() only", () => {
    buf.toString();
  });
});

// 3. JSON.stringify variants
const output = { status: "ok", users: [{ id: 1, name: "Alice" }], total: 1 };

summary(() => {
  bench("JSON.stringify (native)", () => {
    JSON.stringify(output);
  });

  bench("stringifyJSON (BigInt safe)", () => {
    JSON.stringify(output, (_k, v) => typeof v === "bigint" ? v.toString() : v);
  });
});

// 4. res.setHeader overhead
import { createServer } from "node:http";

// 5. async IIFE overhead
summary(() => {
  bench("async IIFE", async () => {
    await (async () => { return 1; })();
  });

  bench("direct async", async () => {
    return 1;
  });
});

// 6. Promise constructor for body
summary(() => {
  bench("new Promise (body read pattern)", async () => {
    await new Promise<string>((resolve) => resolve("test"));
  });

  bench("Promise.resolve", async () => {
    await Promise.resolve("test");
  });
});

await run();
