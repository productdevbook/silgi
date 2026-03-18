import { katmanNitro } from "katman/nitro";
import { appRouter, db } from "../../rpc";

export default katmanNitro(appRouter, {
  context: (event) => ({
    db,
    token: event.req.headers.get("authorization")?.replace("Bearer ", ""),
  }),
});
