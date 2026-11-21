import { readFileSync } from "node:fs";
import { z } from "zod";
import { normalizePrivateKeyPem } from "../github/jwt.js";

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

const GitHubAppEnvSchema = z.object({
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_INSTALLATION_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY_PATH: z.string().optional(),
});

const GatewayEnvSchema = BaseHatchetEnvSchema.extend({
  WEBHOOK_PORT: PositiveIntFromEnv,
  GITHUB_WEBHOOK_SECRET: z.string().min(1),
});

const WorkerEnvSchema = BaseHatchetEnvSchema.merge(GitHubAppEnvSchema).extend({
  HATCHET_WORKER_SLOTS: PositiveIntFromEnv,
});

export type TokenFileReader = (filePath: string) => string;

export type GitHubAppConfig = {
  appId: string;
  installationId: string;
  privateKeyPem: string;
};

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
  githubApp?: GitHubAppConfig;
};

const defaultReadTokenFile: TokenFileReader = (filePath) =>
  readFileSync(filePath, "utf8");

const resolvePrivateKeyPem = (
  inlineKey: string | undefined,
  keyPath: string | undefined,
  readFile: TokenFileReader
): string => {
  const trimmedInline = inlineKey?.trim() ?? "";
  if (trimmedInline.length > 0) {
    return normalizePrivateKeyPem(trimmedInline);
  }

  const trimmedPath = keyPath?.trim() ?? "";
  if (trimmedPath.length > 0) {
    const fileKey = normalizePrivateKeyPem(readFile(trimmedPath));
    if (fileKey.length > 0) {
      return fileKey;
    }
  }

  throw new Error(
    "Missing GITHUB_APP_PRIVATE_KEY (set GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_PATH)"
  );
};

const hasAnyGitHubAppEnv = (
  parsed: z.infer<typeof GitHubAppEnvSchema>
): boolean =>
  [
    parsed.GITHUB_APP_ID,
    parsed.GITHUB_APP_INSTALLATION_ID,
    parsed.GITHUB_APP_PRIVATE_KEY,
    parsed.GITHUB_APP_PRIVATE_KEY_PATH,
  ].some((value) => (value?.trim() ?? "").length > 0);

const parseRequiredGitHubApp = (
  parsed: z.infer<typeof GitHubAppEnvSchema>,
  readFile: TokenFileReader
): GitHubAppConfig => {
  const appId = parsed.GITHUB_APP_ID?.trim() ?? "";
  if (appId.length === 0) {
    throw new Error("Missing GITHUB_APP_ID");
  }

  const installationId = parsed.GITHUB_APP_INSTALLATION_ID?.trim() ?? "";
  if (installationId.length === 0) {
    throw new Error("Missing GITHUB_APP_INSTALLATION_ID");
  }

  const privateKeyPem = resolvePrivateKeyPem(
    parsed.GITHUB_APP_PRIVATE_KEY,
    parsed.GITHUB_APP_PRIVATE_KEY_PATH,
    readFile
  );

  return { appId, installationId, privateKeyPem };
};

export const loadGitHubAppConfig = (
  env: Record<string, string | undefined> = process.env,
  readFile: TokenFileReader = defaultReadTokenFile
): GitHubAppConfig => {
  const parsed = GitHubAppEnvSchema.parse(env);
  return parseRequiredGitHubApp(parsed, readFile);
};

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
  const githubApp = hasAnyGitHubAppEnv(parsed)
    ? parseRequiredGitHubApp(parsed, readTokenFile)
    : undefined;

  return {
    hatchetClientToken,
    hatchetHostPort: parsed.HATCHET_CLIENT_HOST_PORT,
    hatchetTlsStrategy: parsed.HATCHET_CLIENT_TLS_STRATEGY,
    workerSlots: parsed.HATCHET_WORKER_SLOTS ?? 4,
    ...(githubApp ? { githubApp } : {}),
  };
};
