import { lookup } from "node:dns/promises";
import { classifyIpAddress, isIpLiteral } from "./ip-filter.js";

export const DEFAULT_ALLOWLIST_DOMAINS = [
  "api.anthropic.com",
  "registry.npmjs.org",
] as const;

export const DEFAULT_ALLOWED_PORTS = [80, 443] as const;

export const INTERNAL_BLOCKED_HOSTNAMES = [
  "localhost",
  "host.docker.internal",
  "gateway.docker.internal",
  "hatchet-lite",
  "phoenix",
  "postgres",
  "webhook-gateway",
  "factory-worker",
  "egress-proxy",
] as const;

const INTERNAL_BLOCKED_SET: ReadonlySet<string> = new Set(
  INTERNAL_BLOCKED_HOSTNAMES
);

const INTERNAL_SUFFIXES = [
  ".local",
  ".internal",
  ".localhost",
  ".lan",
  ".home.arpa",
] as const;

const HOSTNAME_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export type DnsRecord = {
  address: string;
  family: 4 | 6;
};

export type DnsResolver = (hostname: string) => Promise<readonly DnsRecord[]>;

export type EgressPolicy = {
  allowlistDomains: readonly string[];
  allowedPorts: readonly number[];
};

export type EgressAuthorizationRequest = {
  host: string;
  port: number;
  policy: EgressPolicy;
  resolveDns?: DnsResolver;
};

export type EgressAuthorizationResult =
  | {
      allowed: true;
      hostname: string;
      port: number;
      resolvedIp: string;
      family: 4 | 6;
    }
  | {
      allowed: false;
      statusCode: 400 | 403 | 502;
      reason: string;
    };

export const defaultDnsResolver: DnsResolver = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => ({
    address: record.address,
    family: record.family === 6 ? 6 : 4,
  }));
};

export const normalizeHostname = (rawHost: string): string => {
  const lowered = rawHost.trim().toLowerCase();
  return lowered.endsWith(".") ? lowered.slice(0, -1) : lowered;
};

const isValidHostnameSyntax = (hostname: string): boolean => {
  if (hostname.length === 0 || hostname.length > 253) {
    return false;
  }
  const labels = hostname.split(".");
  return labels.every((label) => HOSTNAME_LABEL_PATTERN.test(label));
};

const isInternalHostname = (hostname: string): boolean => {
  if (!hostname.includes(".")) {
    return true;
  }
  if (INTERNAL_BLOCKED_SET.has(hostname)) {
    return true;
  }
  return INTERNAL_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
};

const matchesAllowlistEntry = (hostname: string, rawEntry: string): boolean => {
  const normalizedEntry = normalizeHostname(rawEntry);
  if (normalizedEntry.length === 0) {
    return false;
  }
  if (normalizedEntry.startsWith("*.")) {
    const suffix = normalizedEntry.slice(1);
    return hostname.length > suffix.length && hostname.endsWith(suffix);
  }
  return hostname === normalizedEntry;
};

export const isHostnameAllowlisted = (
  hostname: string,
  allowlistDomains: readonly string[]
): boolean =>
  allowlistDomains.some((entry) => matchesAllowlistEntry(hostname, entry));

const validateStaticTarget = (
  rawHost: string,
  port: number,
  policy: EgressPolicy
):
  | { ok: true; hostname: string }
  | { ok: false; statusCode: 400 | 403; reason: string } => {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, statusCode: 400, reason: "invalid_port" };
  }
  if (!policy.allowedPorts.includes(port)) {
    return { ok: false, statusCode: 403, reason: "port_not_allowed" };
  }
  if (isIpLiteral(rawHost)) {
    return { ok: false, statusCode: 403, reason: "ip_literal_not_allowed" };
  }

  const hostname = normalizeHostname(rawHost);
  if (!isValidHostnameSyntax(hostname)) {
    return { ok: false, statusCode: 400, reason: "invalid_hostname" };
  }
  if (isInternalHostname(hostname)) {
    return { ok: false, statusCode: 403, reason: "internal_hostname_blocked" };
  }
  if (!isHostnameAllowlisted(hostname, policy.allowlistDomains)) {
    return { ok: false, statusCode: 403, reason: "domain_not_allowlisted" };
  }

  return { ok: true, hostname };
};

const validateResolvedRecords = (
  records: readonly DnsRecord[]
):
  | { ok: true; resolvedIp: string; family: 4 | 6 }
  | { ok: false; statusCode: 403 | 502; reason: string } => {
  if (records.length === 0) {
    return { ok: false, statusCode: 502, reason: "dns_resolution_failed" };
  }

  let selected: { resolvedIp: string; family: 4 | 6 } | undefined;
  for (const record of records) {
    const check = classifyIpAddress(record.address);
    if (!check.allowed) {
      return {
        ok: false,
        statusCode: 403,
        reason: `resolved_ip_blocked:${check.reason}`,
      };
    }
    if (selected === undefined) {
      selected = { resolvedIp: check.normalizedIp, family: check.family };
    }
  }

  if (selected === undefined) {
    return { ok: false, statusCode: 502, reason: "dns_resolution_failed" };
  }
  return { ok: true, resolvedIp: selected.resolvedIp, family: selected.family };
};

export const authorizeEgressTarget = async (
  request: EgressAuthorizationRequest
): Promise<EgressAuthorizationResult> => {
  const staticCheck = validateStaticTarget(
    request.host,
    request.port,
    request.policy
  );
  if (!staticCheck.ok) {
    return {
      allowed: false,
      statusCode: staticCheck.statusCode,
      reason: staticCheck.reason,
    };
  }

  const resolveDns = request.resolveDns ?? defaultDnsResolver;
  let records: readonly DnsRecord[];
  try {
    records = await resolveDns(staticCheck.hostname);
  } catch {
    return {
      allowed: false,
      statusCode: 502,
      reason: "dns_resolution_failed",
    };
  }

  const resolvedCheck = validateResolvedRecords(records);
  if (!resolvedCheck.ok) {
    return {
      allowed: false,
      statusCode: resolvedCheck.statusCode,
      reason: resolvedCheck.reason,
    };
  }

  return {
    allowed: true,
    hostname: staticCheck.hostname,
    port: request.port,
    resolvedIp: resolvedCheck.resolvedIp,
    family: resolvedCheck.family,
  };
};
