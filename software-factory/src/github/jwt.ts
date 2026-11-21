import { createSign } from "node:crypto";
import type { Clock } from "../shared/types.js";

const CLOCK_DRIFT_BACKDATE_SECONDS = 60;
const JWT_LIFETIME_SECONDS = 540;

export type MintGitHubAppJwtOptions = {
  appId: string;
  privateKeyPem: string;
  clock?: Clock;
};

const encodeBase64UrlJson = (value: Record<string, unknown>): string =>
  Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

export const normalizePrivateKeyPem = (rawKey: string): string =>
  rawKey.replaceAll("\\n", "\n").trim();

export const mintGitHubAppJwt = (options: MintGitHubAppJwtOptions): string => {
  const appId = options.appId.trim();
  if (appId.length === 0) {
    throw new Error("GitHub App ID must not be empty");
  }

  const normalizedKey = normalizePrivateKeyPem(options.privateKeyPem);
  if (normalizedKey.length === 0) {
    throw new Error("GitHub App private key must not be empty");
  }

  const clock = options.clock ?? (() => new Date());
  const nowSeconds = Math.floor(clock().getTime() / 1000);
  const headerSegment = encodeBase64UrlJson({ alg: "RS256", typ: "JWT" });
  const payloadSegment = encodeBase64UrlJson({
    iss: appId,
    iat: nowSeconds - CLOCK_DRIFT_BACKDATE_SECONDS,
    exp: nowSeconds + JWT_LIFETIME_SECONDS,
  });
  const signingInput = `${headerSegment}.${payloadSegment}`;

  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signatureSegment = signer.sign(normalizedKey).toString("base64url");

  return `${signingInput}.${signatureSegment}`;
};
