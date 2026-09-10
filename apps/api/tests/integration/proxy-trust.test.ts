import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { resolveTrustProxy } from "../../src/infrastructure/security/http-hardening.js";

/**
 * Proxy-trust / trustProxy integration tests.
 *
 * Every test exercises the real `resolveTrustProxy()` exported from
 * `infrastructure/security/http-hardening.ts` — the same function
 * `buildApp()` calls at startup. Tests that need to verify Fastify's
 * runtime IP-resolution behavior feed the resolver's output into a
 * real Fastify instance's `trustProxy` option (via `probe()`), so the
 * full chain is validated: env → resolver → Fastify → `req.ip`.
 *
 * No source-string assertions (e.g. `expect(src).toContain(...)`) are
 * used — every claim is proved by behavioral execution.
 */

function fakeEnv(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  // Build a minimal env-like object that only contains the overrides.
  // Keys set to `undefined` are omitted (simulating "unset").
  const env: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined) env[k] = v;
  }
  return env as NodeJS.ProcessEnv;
}

async function probe(
  resolvedTrustProxy: false | string,
  headers: Record<string, string>,
  remoteAddress: string,
): Promise<{ ip: string; proto: string }> {
  // Feed the *resolved* value (from resolveTrustProxy) into Fastify —
  // the same value buildApp() would pass.
  const app = Fastify({ trustProxy: resolvedTrustProxy as never });
  app.get("/probe", async (req) => ({ ip: req.ip, proto: req.protocol }));
  const res = await app.inject({ method: "GET", url: "/probe", headers, remoteAddress });
  await app.close();
  return res.json() as { ip: string; proto: string };
}

// ---------------------------------------------------------------------------
// 1. Resolver: secure defaults
// ---------------------------------------------------------------------------
describe("resolveTrustProxy — secure defaults", () => {
  it("returns false when TRUST_PROXY is unset", () => {
    expect(resolveTrustProxy(fakeEnv({}))).toBe(false);
  });

  it("returns false when TRUST_PROXY is empty string", () => {
    expect(resolveTrustProxy(fakeEnv({ TRUST_PROXY: "" }))).toBe(false);
  });

  it("returns false when TRUST_PROXY is '  ' (whitespace-only)", () => {
    expect(resolveTrustProxy(fakeEnv({ TRUST_PROXY: "   " }))).toBe(false);
  });

  it("returns false when TRUST_PROXY is 'false'", () => {
    expect(resolveTrustProxy(fakeEnv({ TRUST_PROXY: "false" }))).toBe(false);
  });

  it("returns false when TRUST_PROXY is '0'", () => {
    expect(resolveTrustProxy(fakeEnv({ TRUST_PROXY: "0" }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Resolver: reject trust-all and hop-count
// ---------------------------------------------------------------------------
describe("resolveTrustProxy — reject trust-all and hop-count", () => {
  it("rejects TRUST_PROXY=true (trust-all not permitted)", () => {
    expect(() => resolveTrustProxy(fakeEnv({ TRUST_PROXY: "true" }))).toThrow(
      /trust-all is not permitted/,
    );
  });

  it("rejects TRUST_PROXY=1 (trust-all not permitted)", () => {
    expect(() => resolveTrustProxy(fakeEnv({ TRUST_PROXY: "1" }))).toThrow(
      /trust-all is not permitted/,
    );
  });

  it("rejects TRUST_PROXY_HOPS (deprecated hop-count)", () => {
    expect(() =>
      resolveTrustProxy(fakeEnv({ TRUST_PROXY_HOPS: "2" })),
    ).toThrow(/TRUST_PROXY_HOPS is no longer supported/);
  });
});

// ---------------------------------------------------------------------------
// 3. Resolver: valid IP/CIDR allowlist
// ---------------------------------------------------------------------------
describe("resolveTrustProxy — valid IP/CIDR", () => {
  it("accepts a bare IPv4 address", () => {
    expect(resolveTrustProxy(fakeEnv({ TRUST_PROXY: "10.0.0.1" }))).toBe("10.0.0.1");
  });

  it("accepts a bare IPv6 address", () => {
    expect(resolveTrustProxy(fakeEnv({ TRUST_PROXY: "::1" }))).toBe("::1");
  });

  it("accepts an IPv4 CIDR (10.0.0.0/28) — regression for escaped \\d regex", () => {
    // This specific case was broken by the unescaped `/^d+$/` regex that
    // matched literal 'd' instead of digit class, rejecting all numeric
    // CIDR masks. Must remain a permanent regression test.
    expect(resolveTrustProxy(fakeEnv({ TRUST_PROXY: "10.0.0.0/28" }))).toBe("10.0.0.0/28");
  });

  it("accepts an IPv4 CIDR with mask 0", () => {
    expect(resolveTrustProxy(fakeEnv({ TRUST_PROXY: "0.0.0.0/0" }))).toBe("0.0.0.0/0");
  });

  it("accepts an IPv4 CIDR with mask 32", () => {
    expect(resolveTrustProxy(fakeEnv({ TRUST_PROXY: "192.168.1.1/32" }))).toBe("192.168.1.1/32");
  });

  it("accepts an IPv6 CIDR", () => {
    expect(resolveTrustProxy(fakeEnv({ TRUST_PROXY: "fd00::/64" }))).toBe("fd00::/64");
  });

  it("accepts an IPv6 CIDR with mask 128", () => {
    expect(resolveTrustProxy(fakeEnv({ TRUST_PROXY: "::1/128" }))).toBe("::1/128");
  });

  it("accepts comma-separated mixed allowlist", () => {
    const val = "10.0.0.0/28, 172.16.0.5, ::1, loopback";
    expect(resolveTrustProxy(fakeEnv({ TRUST_PROXY: val }))).toBe(val);
  });

  it("accepts proxy-addr sentinels", () => {
    for (const sentinel of ["loopback", "uniqueloopback", "linklocal", "uniquelinklocal"]) {
      expect(resolveTrustProxy(fakeEnv({ TRUST_PROXY: sentinel }))).toBe(sentinel);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Resolver: reject malformed CIDR / invalid values
// ---------------------------------------------------------------------------
describe("resolveTrustProxy — reject malformed values", () => {
  it("rejects non-IP string", () => {
    expect(() => resolveTrustProxy(fakeEnv({ TRUST_PROXY: "not-an-ip" }))).toThrow(
      /Invalid TRUST_PROXY/,
    );
  });

  it("rejects IPv4 CIDR with mask > 32", () => {
    expect(() => resolveTrustProxy(fakeEnv({ TRUST_PROXY: "10.0.0.0/33" }))).toThrow(
      /Invalid TRUST_PROXY/,
    );
  });

  it("rejects IPv6 CIDR with mask > 128", () => {
    expect(() => resolveTrustProxy(fakeEnv({ TRUST_PROXY: "::1/129" }))).toThrow(
      /Invalid TRUST_PROXY/,
    );
  });

  it("rejects signed mask (-8)", () => {
    expect(() => resolveTrustProxy(fakeEnv({ TRUST_PROXY: "10.0.0.0/-8" }))).toThrow(
      /Invalid TRUST_PROXY/,
    );
  });

  it("rejects decimal mask (24.5)", () => {
    expect(() => resolveTrustProxy(fakeEnv({ TRUST_PROXY: "10.0.0.0/24.5" }))).toThrow(
      /Invalid TRUST_PROXY/,
    );
  });

  it("rejects empty mask (trailing slash)", () => {
    expect(() => resolveTrustProxy(fakeEnv({ TRUST_PROXY: "10.0.0.0/" }))).toThrow(
      /Invalid TRUST_PROXY/,
    );
  });

  it("rejects extra slash (double-slash CIDR)", () => {
    expect(() => resolveTrustProxy(fakeEnv({ TRUST_PROXY: "10.0.0.0/24/8" }))).toThrow(
      /Invalid TRUST_PROXY/,
    );
  });

  it("rejects mask with alpha characters", () => {
    expect(() => resolveTrustProxy(fakeEnv({ TRUST_PROXY: "10.0.0.0/ff" }))).toThrow(
      /Invalid TRUST_PROXY/,
    );
  });
});

// ---------------------------------------------------------------------------
// 5. Fastify behavioral: resolver → Fastify → req.ip / req.protocol
// ---------------------------------------------------------------------------
describe("Proxy trust behavioral (resolver → Fastify)", () => {
  it("default (false) ignores spoofed X-Forwarded-For", async () => {
    const resolved = resolveTrustProxy(fakeEnv({}));
    expect(resolved).toBe(false);
    const result = await probe(resolved, { "x-forwarded-for": "1.2.3.4" }, "198.51.100.10");
    expect(result.ip).toBe("198.51.100.10");
    expect(result.ip).not.toBe("1.2.3.4");
  });

  it("trusted peer is accepted and forwards client IP", async () => {
    const resolved = resolveTrustProxy(fakeEnv({ TRUST_PROXY: "203.0.113.10" }));
    expect(resolved).toBe("203.0.113.10");
    const result = await probe(resolved, { "x-forwarded-for": "198.51.100.77" }, "203.0.113.10");
    expect(result.ip).toBe("198.51.100.77");
  });

  it("untrusted peer cannot spoof client IP or protocol", async () => {
    const resolved = resolveTrustProxy(fakeEnv({ TRUST_PROXY: "10.0.0.5" }));
    const result = await probe(
      resolved,
      { "x-forwarded-for": "1.1.1.1", "x-forwarded-proto": "https" },
      "198.51.100.10",
    );
    expect(result.ip).toBe("198.51.100.10");
    expect(result.proto).toBe("http");
  });

  it("CIDR allowlist trusts peer inside range (10.0.0.0/28 regression)", async () => {
    // This is the exact case proven broken by the /^d+$/ regex bug:
    // TRUST_PROXY=10.0.0.0/28 was rejected at startup.
    const resolved = resolveTrustProxy(fakeEnv({ TRUST_PROXY: "10.0.0.0/28" }));
    expect(resolved).toBe("10.0.0.0/28");
    // 10.0.0.5 is inside 10.0.0.0/28 (range 10.0.0.0–10.0.0.15)
    const inside = await probe(resolved, { "x-forwarded-for": "9.9.9.9" }, "10.0.0.5");
    expect(inside.ip).toBe("9.9.9.9");
    // 10.0.1.1 is outside 10.0.0.0/28
    const outside = await probe(resolved, { "x-forwarded-for": "9.9.9.9" }, "10.0.1.1");
    expect(outside.ip).toBe("10.0.1.1");
  });

  it("CIDR allowlist trusts peer inside IPv6 range", async () => {
    const resolved = resolveTrustProxy(fakeEnv({ TRUST_PROXY: "::1/128" }));
    expect(resolved).toBe("::1/128");
    const result = await probe(resolved, { "x-forwarded-for": "2001:db8::1" }, "::1");
    expect(result.ip).toBe("2001:db8::1");
  });

  it("buildApp() starts successfully with a valid CIDR", async () => {
    const prev = process.env.TRUST_PROXY;
    const prevHops = process.env.TRUST_PROXY_HOPS;
    try {
      process.env.TRUST_PROXY = "10.0.0.0/28";
      delete process.env.TRUST_PROXY_HOPS;
      // Dynamic import to get fresh module evaluation
      const mod = await import("../../src/app.js?cidr-start-" + Date.now());
      const app = mod.buildApp();
      // Should be able to inject a health request without crashing
      const res = await app.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(200);
      await app.close();
    } finally {
      if (prev === undefined) delete process.env.TRUST_PROXY;
      else process.env.TRUST_PROXY = prev;
      if (prevHops === undefined) delete process.env.TRUST_PROXY_HOPS;
      else process.env.TRUST_PROXY_HOPS = prevHops;
    }
  });

  it("buildApp() with invalid TRUST_PROXY throws at startup", async () => {
    const prev = process.env.TRUST_PROXY;
    const prevHops = process.env.TRUST_PROXY_HOPS;
    try {
      process.env.TRUST_PROXY = "not-an-ip";
      delete process.env.TRUST_PROXY_HOPS;
      const mod = await import("../../src/app.js?invalid-start-" + Date.now());
      expect(() => mod.buildApp()).toThrow(/Invalid TRUST_PROXY/);
    } finally {
      if (prev === undefined) delete process.env.TRUST_PROXY;
      else process.env.TRUST_PROXY = prev;
      if (prevHops === undefined) delete process.env.TRUST_PROXY_HOPS;
      else process.env.TRUST_PROXY_HOPS = prevHops;
    }
  });

  it("buildApp() with TRUST_PROXY_HOPS throws at startup", async () => {
    const prev = process.env.TRUST_PROXY;
    const prevHops = process.env.TRUST_PROXY_HOPS;
    try {
      delete process.env.TRUST_PROXY;
      process.env.TRUST_PROXY_HOPS = "2";
      const mod = await import("../../src/app.js?hops-start-" + Date.now());
      expect(() => mod.buildApp()).toThrow(/TRUST_PROXY_HOPS is no longer supported/);
    } finally {
      if (prev === undefined) delete process.env.TRUST_PROXY;
      else process.env.TRUST_PROXY = prev;
      if (prevHops === undefined) delete process.env.TRUST_PROXY_HOPS;
      else process.env.TRUST_PROXY_HOPS = prevHops;
    }
  });
});
