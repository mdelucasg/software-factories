import { readFileSync } from "node:fs";
import { z } from "zod";

const TlsStrategySchema = z.enum(["tls", "mtls", "none"]).default("none");

const PositiveIntFromEnv = z
  .string()
  .optional()
  .transform((raw) => (raw && raw.trim().length > 0 ? Number(raw) : undefined))
  .pipe(z.number().int().positive().optional());

const BaseHatchetEnvSchema = z.object({
  HATCHET_CLIENT_TOKEN: z.string().optional(),
  HATCHET_CLIENT_TOKEN_FILE: z.string().optional(),
  HATCHET_CLIENT_HOST_PORT: z.string().min(1).default("hatchet-lite:7077"),
  HATCHET_CLIENT_TLS_STRATEGY: TlsStrategySchema,
});

const GatewayEnvSchema = BaseHatchetEnvSchema.extend({
  WEBHOOK_PORT: PositiveIntFromEnv,
  GITHUB_WEBHOOK_SECRET: z.string().min(1),
});

const WorkerEnvSchema = BaseHatchetEnvSchema.extend({
  HATCHET_WORKER_SLOTS: PositiveIntFromEnv,
});

export type TokenFileReader = (filePath: string) => string;

export type HatchetConnectionConfig = {
  hatchetClientToken: string;
  hatchetHostPort: string;
  hatchetTlsStrategy: "tls" | "mtls" | "none";
};

export type GatewayConfig = HatchetConnectionConfig & {
  webhookPort: number;
  githubWebhookSecret: string;
};

export type WorkerConfig = HatchetConnectionConfig & {
  workerSlots: number;
};

const defaultReadTokenFile: TokenFileReader = (filePath) =>
  readFileSync(filePath, "utf8");

const resolveHatchetToken = (
  envToken: string | undefined,
  tokenFilePath: string | undefined,
  readTokenFile: TokenFileReader
): string => {
  const trimmedEnv = envToken?.trim() ?? "";
  if (trimmedEnv.length > 0) {
    return trimmedEnv;
  }

  const trimmedPath = tokenFilePath?.trim() ?? "";
  if (trimmedPath.length > 0) {
    const fileToken = readTokenFile(trimmedPath).trim();
    if (fileToken.length > 0) {
      return fileToken;
    }
  }

  throw new Error(
    "Missing HATCHET_CLIENT_TOKEN (set HATCHET_CLIENT_TOKEN or HATCHET_CLIENT_TOKEN_FILE)"
  );
};

export const loadGatewayConfig = (
  env: Record<string, string | undefined> = process.env,
  readTokenFile: TokenFileReader = defaultReadTokenFile
): GatewayConfig => {
  const parsed = GatewayEnvSchema.parse(env);
  const hatchetClientToken = resolveHatchetToken(
    parsed.HATCHET_CLIENT_TOKEN,
    parsed.HATCHET_CLIENT_TOKEN_FILE,
    readTokenFile
  );

  return {
    webhookPort: parsed.WEBHOOK_PORT ?? 3000,
    githubWebhookSecret: parsed.GITHUB_WEBHOOK_SECRET,
    hatchetClientToken,
    hatchetHostPort: parsed.HATCHET_CLIENT_HOST_PORT,
    hatchetTlsStrategy: parsed.HATCHET_CLIENT_TLS_STRATEGY,
  };
};

export const loadWorkerConfig = (
  env: Record<string, string | undefined> = process.env,
  readTokenFile: TokenFileReader = defaultReadTokenFile
): WorkerConfig => {
  const parsed = WorkerEnvSchema.parse(env);
  const hatchetClientToken = resolveHatchetToken(
    parsed.HATCHET_CLIENT_TOKEN,
    parsed.HATCHET_CLIENT_TOKEN_FILE,
    readTokenFile
  );

  return {
    hatchetClientToken,
    hatchetHostPort: parsed.HATCHET_CLIENT_HOST_PORT,
    hatchetTlsStrategy: parsed.HATCHET_CLIENT_TLS_STRATEGY,
    workerSlots: parsed.HATCHET_WORKER_SLOTS ?? 4,
  };
};
