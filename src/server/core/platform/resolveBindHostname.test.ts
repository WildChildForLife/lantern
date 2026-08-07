import { describe, expect, it } from "vitest";
import { LOOPBACK_IPV4, resolveBindHostname } from "./resolveBindHostname.ts";

describe("resolveBindHostname", () => {
  it("defaults to the IPv4 loopback", () => {
    // Not "localhost": Node resolves that to ::1 first on a dual-stack machine,
    // which leaves 127.0.0.1 refused.
    expect(resolveBindHostname(undefined, undefined)).toBe(LOOPBACK_IPV4);
  });

  it("resolves an explicit localhost the same way", () => {
    expect(resolveBindHostname("localhost", undefined)).toBe(LOOPBACK_IPV4);
    expect(resolveBindHostname(undefined, "localhost")).toBe(LOOPBACK_IPV4);
  });

  it("passes any other address through untouched", () => {
    expect(resolveBindHostname("0.0.0.0", undefined)).toBe("0.0.0.0");
    expect(resolveBindHostname("::1", undefined)).toBe("::1");
    expect(resolveBindHostname("::", undefined)).toBe("::");
    expect(resolveBindHostname("192.168.1.10", undefined)).toBe("192.168.1.10");
  });

  it("prefers the flag over the environment", () => {
    expect(resolveBindHostname("0.0.0.0", "::1")).toBe("0.0.0.0");
  });

  it("treats an empty value as unset", () => {
    expect(resolveBindHostname("", "0.0.0.0")).toBe("0.0.0.0");
    expect(resolveBindHostname("", "")).toBe(LOOPBACK_IPV4);
  });
});
