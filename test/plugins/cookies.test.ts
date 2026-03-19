import { describe, it, expect } from "vitest";
import { getCookie, parseCookies, setCookie, deleteCookie } from "#src/plugins/cookies.ts";

describe("Cookie helpers", () => {
  it("getCookie extracts a cookie", () => {
    expect(getCookie({ cookie: "a=1; b=2; c=3" }, "b")).toBe("2");
    expect(getCookie({ cookie: "session=abc123" }, "session")).toBe("abc123");
    expect(getCookie({ cookie: "a=1" }, "x")).toBeUndefined();
  });

  it("parseCookies returns all cookies", () => {
    const result = parseCookies({ cookie: "a=1; b=2" });
    expect(result).toEqual({ a: "1", b: "2" });
  });

  it("setCookie creates header value", () => {
    const header = setCookie("session", "abc", { maxAge: 3600, httpOnly: true, secure: false, sameSite: "lax" });
    expect(header).toContain("session=abc");
    expect(header).toContain("Max-Age=3600");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
  });

  it("deleteCookie sets Max-Age=0", () => {
    const header = deleteCookie("session");
    expect(header).toContain("Max-Age=0");
  });
});
