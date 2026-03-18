/**
 * Katman Playground — Client
 *
 * Run: node --experimental-strip-types playground/client.ts
 * (Start server first: pnpm --filter katman-playground dev)
 */

import { KatmanError } from "katman";

const BASE = "http://127.0.0.1:3456";
const AUTH = { Authorization: "Bearer secret-token" };

async function call(path: string, input?: unknown, headers?: Record<string, string>) {
  const res = await fetch(`${BASE}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: input !== undefined ? JSON.stringify(input) : undefined,
  });
  const body = await res.json();
  if (res.status >= 400) {
    throw Object.assign(new Error(body.message), body);
  }
  return body;
}

function hr(title: string) {
  console.log(`\n${"─".repeat(50)}`);
  console.log(`  ${title}`);
  console.log(`${"─".repeat(50)}\n`);
}

async function main() {
  // 1. Health
  hr("1. Health Check");
  const health = await call("health");
  console.log("Status:", health.status);
  console.log("Uptime:", Number(health.uptime).toFixed(1), "s");

  // 2. List users
  hr("2. List Users");
  const { users, total } = await call("users/list", { limit: 10 });
  console.log(`Found ${total} users:`);
  for (const u of users) console.log(`  #${u.id} ${u.name} <${u.email}>`);

  // 3. Get user
  hr("3. Get User #2");
  const bob = await call("users/get", { id: 2 });
  console.log(`Name: ${bob.name}, Email: ${bob.email}`);

  // 4. Create user (with auth)
  hr("4. Create User (auth)");
  const newUser = await call("users/create", { name: "Diana", email: "diana@katman.dev" }, AUTH);
  console.log(`Created: #${newUser.id} ${newUser.name}`);

  // 5. Duplicate email → CONFLICT
  hr("5. Duplicate Email (expect 409)");
  try {
    await call("users/create", { name: "Clone", email: "diana@katman.dev" }, AUTH);
  } catch (e: any) {
    console.log(`Error: ${e.code} (${e.status}) — ${e.message}`);
    console.log(`Defined: ${e.defined}`);
  }

  // 6. No auth → UNAUTHORIZED
  hr("6. No Auth (expect 401)");
  try {
    await call("users/create", { name: "X", email: "x@test.com" });
  } catch (e: any) {
    console.log(`Error: ${e.code} (${e.status}) — ${e.message}`);
  }

  // 7. Not found
  hr("7. Get User #999 (expect 404)");
  try {
    await call("users/get", { id: 999 });
  } catch (e: any) {
    console.log(`Error: ${e.code} (${e.status}) — ${e.message}`);
  }

  // 8. Delete
  hr("8. Delete User #3");
  const deleted = await call("users/delete", { id: 3 }, AUTH);
  console.log("Deleted:", deleted.deleted);

  // 9. Final list
  hr("9. Final User List");
  const final = await call("users/list", {});
  console.log(`Total: ${final.total} users`);
  for (const u of final.users) console.log(`  #${u.id} ${u.name}`);

  console.log("\n✅ All v2 demos completed!\n");
}

main().catch(console.error);
