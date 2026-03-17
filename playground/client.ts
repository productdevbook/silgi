/**
 * Katman Playground — Client
 *
 * Run: node --experimental-strip-types playground/client.ts
 * (Start the server first: node --experimental-strip-types playground/server.ts)
 */

import { createClient, safe, KatmanError, isDefinedError } from "../src/index.ts";
import { RPCLink } from "../src/client/adapters/fetch/index.ts";
import type { RouterClient } from "../src/server/router.ts";
import type { AppRouter } from "./server.ts";

// ── Create typed client ─────────────────────────────

const link = new RPCLink({
  url: "http://127.0.0.1:3456",
  headers: { Authorization: "Bearer secret-token" },
});

const client: RouterClient<AppRouter> = createClient(link);

// ── Helper ──────────────────────────────────────────

function hr(title: string) {
  console.log(`\n${"─".repeat(50)}`);
  console.log(`  ${title}`);
  console.log(`${"─".repeat(50)}\n`);
}

// ── Run demos ───────────────────────────────────────

async function main() {
  // 1. Health check
  hr("1. Health Check");
  const health = await (client as any).health();
  console.log("Status:", health.status);
  console.log("Uptime:", health.uptime.toFixed(1), "s");

  // 2. List users
  hr("2. List Users");
  const { users, total } = await (client as any).users.list({ limit: 10 });
  console.log(`Found ${total} users:`);
  for (const user of users) {
    console.log(`  #${user.id} ${user.name} <${user.email}>`);
  }

  // 3. Get specific user
  hr("3. Get User #2");
  const bob = await (client as any).users.get({ id: 2 });
  console.log(`Name: ${bob.name}`);
  console.log(`Email: ${bob.email}`);

  // 4. Create a new user
  hr("4. Create User");
  const newUser = await (client as any).users.create({
    name: "Diana",
    email: "diana@katman.dev",
  });
  console.log(`Created: #${newUser.id} ${newUser.name} <${newUser.email}>`);

  // 5. Try to create duplicate (expect CONFLICT error)
  hr("5. Duplicate Email (expect error)");
  const result = await safe((client as any).users.create({
    name: "Diana Clone",
    email: "diana@katman.dev",
  }));

  if (result.isError) {
    const err = result.error as KatmanError;
    console.log(`Error code: ${err.code}`);
    console.log(`Status: ${err.status}`);
    console.log(`Message: ${err.message}`);
  }

  // 6. Get non-existent user (expect NOT_FOUND)
  hr("6. Get User #999 (expect error)");
  try {
    await (client as any).users.get({ id: 999 });
  } catch (err) {
    if (err instanceof KatmanError) {
      console.log(`Error: ${err.code} — ${err.message}`);
    }
  }

  // 7. Delete user
  hr("7. Delete User #3");
  const deleted = await (client as any).users.delete({ id: 3 });
  console.log("Deleted:", deleted.deleted);

  // 8. List after changes
  hr("8. Final User List");
  const final = await (client as any).users.list({});
  console.log(`Total: ${final.total} users`);
  for (const user of final.users) {
    console.log(`  #${user.id} ${user.name}`);
  }

  console.log("\n✅ All demos completed!\n");
}

main().catch(console.error);
