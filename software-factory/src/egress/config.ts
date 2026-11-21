import { z } from "zod";
import {
  DEFAULT_ALLOWED_PORTS,
  DEFAULT_ALLOWLIST_DOMAINS,
  normalizeHostname,
} from "./allowlist.js";

const PortNumberSchema = z.number().int().min(1).max(65535);

const OptionalPortFromEnv = z
  .string()
  .optional()
  .transform((raw) => {
    const trimmed = raw?.trim() ?? "";
    return trimmed.length > 0 ? Number(trimmed) : undefined;
  })
  .pipe(PortNumberSchema.optional());

const CsvDomainListFromEnv = z
  .string()
  .optional()
  .transform((raw) => {
    const trimmed = raw?.trim() ?? "";
    if (trimmed.length === 0) {
      return undefined;
    }
    return trimmed
      .split(",")
      .map((entry) => normalizeHostname(entry))
      .filter((entry) => entry.length > 0);
  })
  .pipe(z.array(z.string().min(1)).min(1).optional());

const CsvPortListFromEnv = z
  .string()
  .optional()
  .transform((raw) => {
    const trimmed = raw?.trim() ?? "";
    if (trimmed.length === 0) {
      return undefined;
    }
    return trimmed.split(",").map((entry) => {
      const piece = entry.trim();
      return piece.length > 0 ? Number(piece) : Number.NaN;
    });
  })
  .pipe(z.array(PortNumberSchema).min(1).optional());

const EgressProxyEnvSchema = z.object({
  EGRESS_PROXY_PORT: OptionalPortFromEnv,
  EGRESS_HEALTH_PORT: OptionalPortFromEnv,
  EGRESS_ALLOWLIST_DOMAINS: CsvDomainListFromEnv,
  EGRESS_ALLOWED_PORTS: CsvPortListFromEnv,
});

export type EgressProxyConfig = {
  proxyPort: number;
  healthPort: number;
  allowlistDomains: string[];
  allowedPorts: number[];
};

export const loadEgressProxyConfig = (
  env: Record<string, string | undefined> = process.env
): EgressProxyConfig => {
  const parsed = EgressProxyEnvSchema.parse(env);

  return {
    proxyPort: parsed.EGRESS_PROXY_PORT ?? 3128,
    healthPort: parsed.EGRESS_HEALTH_PORT ?? 3129,
    allowlistDomains: parsed.EGRESS_ALLOWLIST_DOMAINS ?? [
      ...DEFAULT_ALLOWLIST_DOMAINS,
    ],
    allowedPorts: parsed.EGRESS_ALLOWED_PORTS ?? [...DEFAULT_ALLOWED_PORTS],
  };
};
