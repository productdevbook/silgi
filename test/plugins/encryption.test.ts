import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "#src/plugins/signing.ts";

describe("Encryption", () => {
  it("encrypt and decrypt round-trip", async () => {
    const encrypted = await encrypt("secret data", "my-key");
    expect(encrypted).not.toContain("secret data");
    const decrypted = await decrypt(encrypted, "my-key");
    expect(decrypted).toBe("secret data");
  });

  it("different encryptions produce different ciphertexts", async () => {
    const a = await encrypt("same", "key");
    const b = await encrypt("same", "key");
    expect(a).not.toBe(b);
  });
});
