import { defineBuildConfig } from "obuild/config";

export default defineBuildConfig({
  entries: [
    {
      type: "bundle",
      input: [
        "./src/index.ts",
        "./src/server/index.ts",
        "./src/client/index.ts",
        "./src/contract/index.ts",
        "./src/server/adapters/node/index.ts",
        "./src/server/adapters/fetch/index.ts",
        "./src/server/adapters/fastify/index.ts",
        "./src/server/adapters/websocket/index.ts",
        "./src/server/plugins/index.ts",
        "./src/client/adapters/fetch/index.ts",
        "./src/client/plugins/index.ts",
        "./src/openapi/index.ts",
        "./src/integrations/zod/index.ts",
        "./src/integrations/tanstack-query/index.ts",
        "./src/integrations/react/index.ts",
        "./src/plugins/otel/index.ts",
        "./src/plugins/pino/index.ts",
        "./src/plugins/ratelimit/index.ts",
      ],
    },
  ],
});
