import { describe, expect, it } from "vitest";
import {
  authorizeEgressTarget,
  DEFAULT_ALLOWED_PORTS,
  DEFAULT_ALLOWLIST_DOMAINS,
  type DnsResolver,
  type EgressPolicy,
} from "../src/egress/allowlist.js";
import { loadEgressProxyConfig } from "../src/egress/config.js";
import { classifyIpAddress, isIpLiteral } from "../src/egress/ip-filter.js";

describe("IP address filter", () => {
  it("detects raw IPv4 and IPv6 literals including bracketed IPv6", () => {
    expect(isIpLiteral("127.0.0.1")).toBe(true);
    expect(isIpLiteral("192.168.1.1")).toBe(true);
    expect(isIpLiteral("::1")).toBe(true);
    expect(isIpLiteral("[::1]")).toBe(true);
    expect(isIpLiteral("[fe80::1]")).toBe(true);
    expect(isIpLiteral("2130706433")).toBe(true);
    expect(isIpLiteral("0x7f000001")).toBe(true);
    expect(isIpLiteral("0177.0.0.1")).toBe(true);
    expect(isIpLiteral("api.anthropic.com")).toBe(false);
    expect(isIpLiteral("registry.npmjs.org")).toBe(false);
    expect(isIpLiteral("hatchet-lite")).toBe(false);
  });

  it("allows routable public IPv4 and IPv6 addresses", () => {
    expect(classifyIpAddress("104.18.32.7")).toEqual({
      allowed: true,
      normalizedIp: "104.18.32.7",
      family: 4,
    });
    expect(classifyIpAddress("160.79.104.10")).toEqual({
      allowed: true,
      normalizedIp: "160.79.104.10",
      family: 4,
    });
    expect(classifyIpAddress("2606:4700::6812:2007")).toEqual({
      allowed: true,
      normalizedIp: "2606:4700::6812:2007",
      family: 6,
    });
    expect(classifyIpAddress("::ffff:104.18.32.7")).toEqual({
      allowed: true,
      normalizedIp: "104.18.32.7",
      family: 4,
    });
  });

  it("blocks RFC1918, CGNAT/Tailscale, loopback, link-local, unspecified, multicast, and reserved IPv4 ranges", () => {
    const blockedIpv4Addresses = [
      "0.0.0.0",
      "0.255.255.255",
      "10.0.0.1",
      "10.255.255.254",
      "100.64.0.1",
      "100.100.100.100",
      "100.127.255.254",
      "127.0.0.1",
      "127.255.255.254",
      "169.254.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "172.17.0.1",
      "172.31.255.254",
      "192.168.0.1",
      "192.168.1.100",
      "224.0.0.1",
      "239.255.255.255",
      "240.0.0.1",
      "255.255.255.255",
    ];

    for (const address of blockedIpv4Addresses) {
      expect({ address, allowed: classifyIpAddress(address).allowed }).toEqual({
        address,
        allowed: false,
      });
    }

    expect(classifyIpAddress("100.63.255.255").allowed).toBe(true);
    expect(classifyIpAddress("100.128.0.1").allowed).toBe(true);
    expect(classifyIpAddress("172.15.255.255").allowed).toBe(true);
    expect(classifyIpAddress("172.32.0.1").allowed).toBe(true);
  });

  it("blocks IPv6 loopback, unspecified, ULA, link-local, multicast, scoped, and private IPv4-mapped IPv6 addresses", () => {
    const blockedIpv6Addresses = [
      "::",
      "::1",
      "0:0:0:0:0:0:0:1",
      "fc00::1",
      "fd12:3456:789a::1",
      "fe80::1",
      "fe80::1%eth0",
      "febf::1",
      "fec0::1",
      "ff02::1",
      "::ffff:127.0.0.1",
      "::ffff:10.0.0.1",
      "::ffff:100.64.0.1",
      "::ffff:169.254.169.254",
      "::ffff:172.16.0.1",
      "::ffff:192.168.1.1",
      "::ffff:c0a8:0101",
      "::ffff:7f00:0001",
      "::ffff:6440:0001",
      "::127.0.0.1",
      "not-an-ip",
    ];

    for (const address of blockedIpv6Addresses) {
      expect({ address, allowed: classifyIpAddress(address).allowed }).toEqual({
        address,
        allowed: false,
      });
    }
  });
});

describe("Egress allowlist and post-DNS authorization", () => {
  const defaultPolicy: EgressPolicy = {
    allowlistDomains: [...DEFAULT_ALLOWLIST_DOMAINS],
    allowedPorts: [...DEFAULT_ALLOWED_PORTS],
  };

  it("authorizes default allowlisted domains after verifying public DNS records", async () => {
    const resolvedHosts: string[] = [];
    const resolveDns: DnsResolver = async (hostname) => {
      resolvedHosts.push(hostname);
      return [{ address: "160.79.104.10", family: 4 }];
    };

    const anthropicResult = await authorizeEgressTarget({
      host: "API.ANTHROPIC.COM.",
      port: 443,
      policy: defaultPolicy,
      resolveDns,
    });
    const npmResult = await authorizeEgressTarget({
      host: "registry.npmjs.org",
      port: 80,
      policy: defaultPolicy,
      resolveDns,
    });

    expect(anthropicResult).toEqual({
      allowed: true,
      hostname: "api.anthropic.com",
      port: 443,
      resolvedIp: "160.79.104.10",
      family: 4,
    });
    expect(npmResult).toEqual({
      allowed: true,
      hostname: "registry.npmjs.org",
      port: 80,
      resolvedIp: "160.79.104.10",
      family: 4,
    });
    expect(resolvedHosts).toEqual(["api.anthropic.com", "registry.npmjs.org"]);
  });

  it("supports explicit wildcard patterns without matching bare root or lookalike suffixes", async () => {
    const policy: EgressPolicy = {
      allowlistDomains: ["*.anthropic.com"],
      allowedPorts: [443],
    };
    const resolveDns: DnsResolver = async () => [
      { address: "160.79.104.10", family: 4 },
    ];

    const subResult = await authorizeEgressTarget({
      host: "api.anthropic.com",
      port: 443,
      policy,
      resolveDns,
    });
    const deepSubResult = await authorizeEgressTarget({
      host: "us.api.anthropic.com",
      port: 443,
      policy,
      resolveDns,
    });
    const bareRootResult = await authorizeEgressTarget({
      host: "anthropic.com",
      port: 443,
      policy,
      resolveDns,
    });
    const lookalikeResult = await authorizeEgressTarget({
      host: "evil-anthropic.com",
      port: 443,
      policy,
      resolveDns,
    });

    expect(subResult.allowed).toBe(true);
    expect(deepSubResult.allowed).toBe(true);
    expect(bareRootResult).toEqual({
      allowed: false,
      statusCode: 403,
      reason: "domain_not_allowlisted",
    });
    expect(lookalikeResult).toEqual({
      allowed: false,
      statusCode: 403,
      reason: "domain_not_allowlisted",
    });
  });

  it("rejects unlisted domains, raw IP literals, internal hostnames, and disallowed ports before DNS", async () => {
    let dnsCallCount = 0;
    const resolveDns: DnsResolver = async () => {
      dnsCallCount += 1;
      return [{ address: "93.184.216.34", family: 4 }];
    };

    const deniedTargets = [
      {
        host: "example.com",
        port: 443,
        expectedReason: "domain_not_allowlisted",
      },
      {
        host: "192.168.1.1",
        port: 443,
        expectedReason: "ip_literal_not_allowed",
      },
      { host: "127.0.0.1", port: 80, expectedReason: "ip_literal_not_allowed" },
      { host: "[::1]", port: 443, expectedReason: "ip_literal_not_allowed" },
      {
        host: "hatchet-lite",
        port: 80,
        expectedReason: "internal_hostname_blocked",
      },
      {
        host: "phoenix",
        port: 80,
        expectedReason: "internal_hostname_blocked",
      },
      {
        host: "postgres",
        port: 80,
        expectedReason: "internal_hostname_blocked",
      },
      {
        host: "webhook-gateway",
        port: 80,
        expectedReason: "internal_hostname_blocked",
      },
      {
        host: "factory-worker",
        port: 80,
        expectedReason: "internal_hostname_blocked",
      },
      {
        host: "host.docker.internal",
        port: 443,
        expectedReason: "internal_hostname_blocked",
      },
      {
        host: "api.anthropic.com",
        port: 5432,
        expectedReason: "port_not_allowed",
      },
      {
        host: "api.anthropic.com",
        port: 8888,
        expectedReason: "port_not_allowed",
      },
    ];

    for (const target of deniedTargets) {
      const result = await authorizeEgressTarget({
        host: target.host,
        port: target.port,
        policy: defaultPolicy,
        resolveDns,
      });

      expect({ target: `${target.host}:${target.port}`, result }).toEqual({
        target: `${target.host}:${target.port}`,
        result: {
          allowed: false,
          statusCode: 403,
          reason: target.expectedReason,
        },
      });
    }

    expect(dnsCallCount).toBe(0);
  });

  it("rejects allowlisted hostnames when any resolved DNS record points to a private, CGNAT, or IPv6-private IP", async () => {
    const poisonedAnswers = [
      [{ address: "192.168.1.50", family: 4 as const }],
      [{ address: "100.64.0.12", family: 4 as const }],
      [{ address: "172.18.0.2", family: 4 as const }],
      [{ address: "169.254.169.254", family: 4 as const }],
      [{ address: "fd00::1", family: 6 as const }],
      [
        { address: "160.79.104.10", family: 4 as const },
        { address: "127.0.0.1", family: 4 as const },
      ],
    ];

    for (const records of poisonedAnswers) {
      const result = await authorizeEgressTarget({
        host: "api.anthropic.com",
        port: 443,
        policy: defaultPolicy,
        resolveDns: async () => records,
      });

      expect(result).toMatchObject({
        allowed: false,
        statusCode: 403,
        reason: expect.stringContaining("resolved_ip_blocked"),
      });
    }
  });

  it("returns 502 when DNS resolution fails or returns empty records", async () => {
    const emptyResult = await authorizeEgressTarget({
      host: "api.anthropic.com",
      port: 443,
      policy: defaultPolicy,
      resolveDns: async () => [],
    });
    const errorResult = await authorizeEgressTarget({
      host: "api.anthropic.com",
      port: 443,
      policy: defaultPolicy,
      resolveDns: async () => {
        throw new Error("ENOTFOUND");
      },
    });

    expect(emptyResult).toEqual({
      allowed: false,
      statusCode: 502,
      reason: "dns_resolution_failed",
    });
    expect(errorResult).toEqual({
      allowed: false,
      statusCode: 502,
      reason: "dns_resolution_failed",
    });
  });
});

describe("Egress proxy environment configuration", () => {
  it("loads safe default ports and Anthropic + npm allowlist when env vars are omitted", () => {
    const config = loadEgressProxyConfig({});

    expect(config).toEqual({
      proxyPort: 3128,
      healthPort: 3129,
      allowlistDomains: ["api.anthropic.com", "registry.npmjs.org"],
      allowedPorts: [80, 443],
    });
  });

  it("parses custom allowlist domains, allowed ports, and listener ports", () => {
    const config = loadEgressProxyConfig({
      EGRESS_PROXY_PORT: "4128",
      EGRESS_HEALTH_PORT: "4129",
      EGRESS_ALLOWLIST_DOMAINS:
        " API.ANTHROPIC.COM , registry.npmjs.org , *.anthropic.com ",
      EGRESS_ALLOWED_PORTS: "443, 8080",
    });

    expect(config).toEqual({
      proxyPort: 4128,
      healthPort: 4129,
      allowlistDomains: [
        "api.anthropic.com",
        "registry.npmjs.org",
        "*.anthropic.com",
      ],
      allowedPorts: [443, 8080],
    });
  });

  it("rejects invalid port values in egress proxy environment configuration", () => {
    expect(() =>
      loadEgressProxyConfig({
        EGRESS_ALLOWED_PORTS: "443,not-a-port",
      })
    ).toThrow();
    expect(() =>
      loadEgressProxyConfig({
        EGRESS_PROXY_PORT: "99999",
      })
    ).toThrow();
  });
});
