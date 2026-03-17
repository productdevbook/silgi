import { describe, it, expect, vi } from "vitest";
import { createQueryUtils, generateKey } from "../src/integrations/tanstack-query/index.ts";
import type { NestedClient, Client } from "../src/client/types.ts";

describe("TanStack Query Integration", () => {
  // Mock client
  const mockClient = {
    users: {
      list: vi.fn(async (input: { limit?: number }) => [{ id: 1, name: "Alice" }]),
      get: vi.fn(async (input: { id: number }) => ({ id: input.id, name: "Alice" })),
      create: vi.fn(async (input: { name: string }) => ({ id: 2, name: input.name })),
    },
    posts: {
      list: vi.fn(async () => []),
    },
  };

  describe("generateKey", () => {
    it("generates a key with path and type", () => {
      const key = generateKey(["users", "list"], { type: "query", input: { limit: 10 } });
      expect(key).toEqual([["users", "list"], { type: "query", input: { limit: 10 } }]);
    });

    it("generates a minimal key without options", () => {
      const key = generateKey(["users", "list"]);
      expect(key).toEqual([["users", "list"], {}]);
    });
  });

  describe("createQueryUtils", () => {
    const utils = createQueryUtils(mockClient as any);

    it("provides .key() at router level for bulk invalidation", () => {
      const key = utils.key();
      expect(key).toEqual([[], {}]);
    });

    it("provides .key() at nested level", () => {
      const key = (utils as any).users.key();
      expect(key[0]).toEqual(["users"]);
    });

    it("provides .queryKey() at procedure level", () => {
      const key = (utils as any).users.list.queryKey({ limit: 5 });
      expect(key[0]).toEqual(["users", "list"]);
      expect(key[1].type).toBe("query");
      expect(key[1].input).toEqual({ limit: 5 });
    });

    it("provides .queryOptions() for useQuery", () => {
      const options = (utils as any).users.list.queryOptions({
        input: { limit: 10 },
        staleTime: 5000,
      });

      expect(options.queryKey).toBeDefined();
      expect(options.queryKey[0]).toEqual(["users", "list"]);
      expect(typeof options.queryFn).toBe("function");
      expect(options.staleTime).toBe(5000);
    });

    it("queryFn calls the client", async () => {
      const options = (utils as any).users.list.queryOptions({
        input: { limit: 3 },
      });

      const result = await options.queryFn({ signal: AbortSignal.timeout(5000) });
      expect(mockClient.users.list).toHaveBeenCalledWith(
        { limit: 3 },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it("provides .mutationKey()", () => {
      const key = (utils as any).users.create.mutationKey();
      expect(key[0]).toEqual(["users", "create"]);
      expect(key[1].type).toBe("mutation");
    });

    it("provides .mutationOptions() for useMutation", () => {
      const onSuccess = vi.fn();
      const options = (utils as any).users.create.mutationOptions({
        onSuccess,
      });

      expect(options.mutationKey).toBeDefined();
      expect(typeof options.mutationFn).toBe("function");
      expect(options.onSuccess).toBe(onSuccess);
    });

    it("mutationFn calls the client", async () => {
      const options = (utils as any).users.create.mutationOptions();
      await options.mutationFn({ name: "Bob" });
      expect(mockClient.users.create).toHaveBeenCalledWith({ name: "Bob" });
    });

    it("provides .call() for direct invocation", async () => {
      await (utils as any).users.get.call({ id: 42 });
      expect(mockClient.users.get).toHaveBeenCalled();
      expect(mockClient.users.get.mock.calls[0]![0]).toEqual({ id: 42 });
    });
  });
});
