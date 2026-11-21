import { z } from "zod";
import type { Clock } from "../shared/types.js";
import { mintGitHubAppJwt } from "./jwt.js";

const DEFAULT_API_BASE_URL = "https://api.github.com";
const DEFAULT_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const GITHUB_API_VERSION = "2022-11-28";

const InstallationTokenResponseSchema = z.object({
  token: z.string().min(1),
  expires_at: z.string().datetime(),
  permissions: z.record(z.string()).optional(),
});

export type GitHubInstallationToken = {
  token: string;
  expiresAt: string;
  permissions?: Record<string, string>;
};

export type GitHubInstallationTokenProvider = {
  getToken: () => Promise<GitHubInstallationToken>;
};

export type GitHubAppAuthOptions = {
  appId: string;
  installationId: string;
  privateKeyPem: string;
  apiBaseUrl?: string;
  refreshBufferMs?: number;
  clock?: Clock;
  fetchImpl?: typeof fetch;
};

type CachedToken = {
  token: GitHubInstallationToken;
  expiresAtMs: number;
};

const normalizeBaseUrl = (rawUrl: string): string => rawUrl.replace(/\/+$/, "");

const isTokenReusable = (
  cached: CachedToken | undefined,
  nowMs: number,
  refreshBufferMs: number
): cached is CachedToken =>
  cached !== undefined && cached.expiresAtMs - nowMs > refreshBufferMs;

const requestInstallationToken = async (
  options: Required<
    Pick<
      GitHubAppAuthOptions,
      "appId" | "installationId" | "privateKeyPem" | "apiBaseUrl" | "clock"
    >
  > & { fetchImpl: typeof fetch }
): Promise<CachedToken> => {
  const jwt = mintGitHubAppJwt({
    appId: options.appId,
    privateKeyPem: options.privateKeyPem,
    clock: options.clock,
  });
  const encodedInstallationId = encodeURIComponent(options.installationId);
  const url = `${options.apiBaseUrl}/app/installations/${encodedInstallationId}/access_tokens`;

  const response = await options.fetchImpl(url, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${jwt}`,
      "x-github-api-version": GITHUB_API_VERSION,
      "user-agent": "software-factory",
    },
  });

  if (!response.ok) {
    throw new Error(
      `GitHub App installation token exchange failed with HTTP ${response.status}`
    );
  }

  const rawBody: unknown = await response.json();
  const parsed = InstallationTokenResponseSchema.parse(rawBody);
  const expiresAtMs = Date.parse(parsed.expires_at);
  const installationToken: GitHubInstallationToken = {
    token: parsed.token,
    expiresAt: parsed.expires_at,
    ...(parsed.permissions ? { permissions: parsed.permissions } : {}),
  };

  return { token: installationToken, expiresAtMs };
};

export const createGitHubAppAuth = (
  options: GitHubAppAuthOptions
): GitHubInstallationTokenProvider => {
  const installationId = options.installationId.trim();
  if (installationId.length === 0) {
    throw new Error("GitHub App installation ID must not be empty");
  }

  const clock = options.clock ?? (() => new Date());
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiBaseUrl = normalizeBaseUrl(
    options.apiBaseUrl ?? DEFAULT_API_BASE_URL
  );
  const refreshBufferMs = options.refreshBufferMs ?? DEFAULT_REFRESH_BUFFER_MS;

  let cached: CachedToken | undefined;
  let pendingFetch: Promise<CachedToken> | undefined;

  const getToken = async (): Promise<GitHubInstallationToken> => {
    const nowMs = clock().getTime();
    if (isTokenReusable(cached, nowMs, refreshBufferMs)) {
      return cached.token;
    }

    if (!pendingFetch) {
      pendingFetch = requestInstallationToken({
        appId: options.appId,
        installationId,
        privateKeyPem: options.privateKeyPem,
        apiBaseUrl,
        clock,
        fetchImpl,
      }).finally(() => {
        pendingFetch = undefined;
      });
    }

    const fresh = await pendingFetch;
    cached = fresh;
    return fresh.token;
  };

  return { getToken };
};
