import { defineBuildConfig } from "obuild/config";

export default defineBuildConfig({
  entries: [
    {
      type: "bundle",
      input: [
        "./src/index.ts",
        "./src/client/index.ts",
        "./src/client/adapters/fetch/index.ts",
        "./src/client/adapters/ofetch/index.ts",
        "./src/client/plugins/index.ts",
        "./src/codec/msgpack.ts",
        "./src/codec/devalue.ts",
        "./src/ws.ts",
        "./src/integrations/zod/index.ts",
        "./src/integrations/tanstack-query/index.ts",
        "./src/integrations/react/index.ts",
        "./src/plugins/index.ts",
        "./src/plugins/cors.ts",
        "./src/plugins/otel.ts",
        "./src/plugins/pino.ts",
        "./src/plugins/ratelimit.ts",
        "./src/adapters/fastify.ts",
        "./src/contract.ts",
        "./src/integrations/ai/index.ts",
      ],
    },
  ],
});
