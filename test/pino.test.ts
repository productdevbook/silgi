import { describe, it, expect, vi } from "vitest";
import { LoggingPlugin, getLogger, type Logger } from "../src/plugins/pino/index.ts";

function createMockLogger(): Logger & { calls: Array<{ level: string; msg?: string; obj: Record<string, unknown> }> } {
  const calls: Array<{ level: string; msg?: string; obj: Record<string, unknown> }> = [];

  const createLevel = (level: string) =>
    (obj: Record<string, unknown>, msg?: string) => { calls.push({ level, obj, msg }); };

  const logger: any = {
    calls,
    child: vi.fn(() => logger),
    info: vi.fn(createLevel("info")),
    error: vi.fn(createLevel("error")),
    warn: vi.fn(createLevel("warn")),
    debug: vi.fn(createLevel("debug")),
  };

  return logger;
}

describe("LoggingPlugin", () => {
  it("creates and injects child logger", () => {
    const logger = createMockLogger();
    const plugin = new LoggingPlugin({ logger });

    const options: any = {};
    plugin.init(options);

    expect(options.rootInterceptors).toBeDefined();
    expect(options.rootInterceptors.length).toBe(1);
    expect(logger.child).not.toHaveBeenCalled(); // Not called until request
  });

  it("has correct order", () => {
    const plugin = new LoggingPlugin({ logger: createMockLogger() });
    expect(plugin.order).toBe(500_000);
  });
});

describe("getLogger", () => {
  it("returns undefined for context without logger", () => {
    expect(getLogger({})).toBeUndefined();
  });
});
