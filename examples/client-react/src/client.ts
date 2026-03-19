import { createClient } from "katman/client";
import { createLink } from "katman/client/ofetch";
import { createQueryUtils } from "katman/tanstack-query";

// Type-safe client: import your AppRouter type from the server
// import type { AppRouter } from "../../standalone/server";

// For this example, we define the router shape inline.
// In a real app, share the type from your server project.
interface AppRouter {
  health: () => { status: string };
  echo: (input: { msg: string }) => { echo: string };
  greet: (input: { name: string }) => { greeting: string };
}

const link = createLink({ url: "http://localhost:3000" });

export const client = createClient<AppRouter>(link);
export const queryUtils = createQueryUtils(client);
