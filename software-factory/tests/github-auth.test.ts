import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createGitHubAppAuth } from "../src/github/app-auth.js";
import { mintGitHubAppJwt } from "../src/github/jwt.js";
import { loadGitHubAppConfig, loadWorkerConfig } from "../src/shared/config.js";

const { privateKey: TEST_PRIVATE_KEY_PEM, publicKey: TEST_PUBLIC_KEY_PEM } =
  generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

const decodeJwtSegment = (segment: string): Record<string, unknown> =>
  JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;

describe("GitHub App RS256 JWT minting", () => {
  it("mints a verifiable RS256 JWT with backdated iat and 9-minute exp", () => {
    const fixedClock = () => new Date("2026-11-21T06:00:00.000Z");

    const token = mintGitHubAppJwt({
      appId: "123456",
      privateKeyPem: TEST_PRIVATE_KEY_PEM,
      clock: fixedClock,
    });

    const parts = token.split(".");
    expect(parts).toHaveLength(3);

    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const header = decodeJwtSegment(encodedHeader ?? "");
    const payload = decodeJwtSegment(encodedPayload ?? "");

    expect(header).toEqual({ alg: "RS256", typ: "JWT" });
    expect(payload).toEqual({
      iss: "123456",
      iat: 1795240740,
      exp: 1795241340,
    });

    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${encodedHeader}.${encodedPayload}`);
    verifier.end();
    const isValid = verifier.verify(
      TEST_PUBLIC_KEY_PEM,
      Buffer.from(encodedSignature ?? "", "base64url")
    );
    expect(isValid).toBe(true);
  });

  it("supports escaped-newline PEM strings from single-line env vars and rejects empty credentials", () => {
    const escapedKey = TEST_PRIVATE_KEY_PEM.replaceAll("\n", "\\n");
    const fixedClock = () => new Date("2026-11-21T06:00:00.000Z");

    const token = mintGitHubAppJwt({
      appId: "998877",
      privateKeyPem: escapedKey,
      clock: fixedClock,
    });

    const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${encodedHeader}.${encodedPayload}`);
    verifier.end();
    expect(
      verifier.verify(
        TEST_PUBLIC_KEY_PEM,
        Buffer.from(encodedSignature ?? "", "base64url")
      )
    ).toBe(true);

    expect(() =>
      mintGitHubAppJwt({
        appId: "   ",
        privateKeyPem: TEST_PRIVATE_KEY_PEM,
        clock: fixedClock,
      })
    ).toThrow(/App ID/);

    expect(() =>
      mintGitHubAppJwt({
        appId: "998877",
        privateKeyPem: "  ",
        clock: fixedClock,
      })
    ).toThrow(/private key/);
  });
});

describe("GitHub App installation token provider", () => {
  it("exchanges an RS256 JWT for a short-lived installation token and caches it until inside the refresh buffer", async () => {
    let currentTime = new Date("2026-11-21T06:00:00.000Z");
    const clock = () => currentTime;
    const requests: Array<{
      url: string;
      method: string;
      headers: Record<string, string>;
    }> = [];
    let tokenCounter = 0;

    const fakeFetch: typeof fetch = async (input, init) => {
      tokenCounter += 1;
      const headers = new Headers(init?.headers);
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        headers: {
          accept: headers.get("accept") ?? "",
          authorization: headers.get("authorization") ?? "",
          apiVersion: headers.get("x-github-api-version") ?? "",
        },
      });
      const expiresAt = new Date(
        currentTime.getTime() + 60 * 60 * 1000
      ).toISOString();
      return new Response(
        JSON.stringify({
          token: `ghs_short_lived_${tokenCounter}`,
          expires_at: expiresAt,
          permissions: {
            contents: "write",
            issues: "write",
            pull_requests: "write",
          },
        }),
        { status: 201, headers: { "content-type": "application/json" } }
      );
    };

    const appAuth = createGitHubAppAuth({
      appId: "123456",
      installationId: "789012",
      privateKeyPem: TEST_PRIVATE_KEY_PEM,
      clock,
      fetchImpl: fakeFetch,
    });

    const first = await appAuth.getToken();
    expect(first).toEqual({
      token: "ghs_short_lived_1",
      expiresAt: "2026-11-21T07:00:00.000Z",
      permissions: {
        contents: "write",
        issues: "write",
        pull_requests: "write",
      },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      "https://api.github.com/app/installations/789012/access_tokens"
    );
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.headers.accept).toBe("application/vnd.github+json");
    expect(requests[0]?.headers.apiVersion).toBe("2022-11-28");

    const bearerJwt = requests[0]?.headers.authorization?.replace(
      /^Bearer /,
      ""
    );
    const [encodedHeader, encodedPayload, encodedSignature] = (
      bearerJwt ?? ""
    ).split(".");
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${encodedHeader}.${encodedPayload}`);
    verifier.end();
    expect(
      verifier.verify(
        TEST_PUBLIC_KEY_PEM,
        Buffer.from(encodedSignature ?? "", "base64url")
      )
    ).toBe(true);

    currentTime = new Date("2026-11-21T06:54:59.000Z");
    const cached = await appAuth.getToken();
    expect(cached.token).toBe("ghs_short_lived_1");
    expect(requests).toHaveLength(1);

    currentTime = new Date("2026-11-21T06:55:00.000Z");
    const refreshed = await appAuth.getToken();
    expect(refreshed.token).toBe("ghs_short_lived_2");
    expect(refreshed.expiresAt).toBe("2026-11-21T07:55:00.000Z");
    expect(requests).toHaveLength(2);
  });

  it("deduplicates concurrent token requests and recovers after an upstream failure without leaking credentials", async () => {
    const fixedClock = () => new Date("2026-11-21T06:00:00.000Z");
    let fetchCalls = 0;
    let shouldFail = true;

    const fakeFetch: typeof fetch = async () => {
      fetchCalls += 1;
      if (shouldFail) {
        return new Response(JSON.stringify({ message: "Unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          token: "ghs_recovered_token",
          expires_at: "2026-11-21T07:00:00.000Z",
        }),
        { status: 201, headers: { "content-type": "application/json" } }
      );
    };

    const appAuth = createGitHubAppAuth({
      appId: "123456",
      installationId: "789012",
      privateKeyPem: TEST_PRIVATE_KEY_PEM,
      clock: fixedClock,
      fetchImpl: fakeFetch,
    });

    const failure = await appAuth.getToken().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    const errorMessage = failure instanceof Error ? failure.message : "";
    expect(errorMessage).toContain("401");
    expect(errorMessage).not.toContain("PRIVATE KEY");
    expect(errorMessage).not.toContain("Bearer");

    shouldFail = false;
    const [firstParallel, secondParallel] = await Promise.all([
      appAuth.getToken(),
      appAuth.getToken(),
    ]);

    expect(firstParallel.token).toBe("ghs_recovered_token");
    expect(secondParallel.token).toBe("ghs_recovered_token");
    expect(fetchCalls).toBe(2);
  });
});

describe("GitHub App environment configuration", () => {
  it("loads GitHub App config from inline escaped key or private key file without reading PAT env vars", () => {
    const inlineConfig = loadGitHubAppConfig({
      GITHUB_APP_ID: "555",
      GITHUB_APP_INSTALLATION_ID: "777",
      GITHUB_APP_PRIVATE_KEY: TEST_PRIVATE_KEY_PEM.replaceAll("\n", "\\n"),
      GITHUB_TOKEN: "ghp_should_never_be_used",
    });

    expect(inlineConfig).toEqual({
      appId: "555",
      installationId: "777",
      privateKeyPem: TEST_PRIVATE_KEY_PEM.trim(),
    });

    const fileConfig = loadGitHubAppConfig(
      {
        GITHUB_APP_ID: "555",
        GITHUB_APP_INSTALLATION_ID: "777",
        GITHUB_APP_PRIVATE_KEY_PATH: "/secrets/github-app.pem",
      },
      (filePath) => {
        expect(filePath).toBe("/secrets/github-app.pem");
        return TEST_PRIVATE_KEY_PEM;
      }
    );

    expect(fileConfig).toEqual({
      appId: "555",
      installationId: "777",
      privateKeyPem: TEST_PRIVATE_KEY_PEM.trim(),
    });

    const workerWithApp = loadWorkerConfig({
      HATCHET_CLIENT_TOKEN: "hatchet-jwt",
      GITHUB_APP_ID: "555",
      GITHUB_APP_INSTALLATION_ID: "777",
      GITHUB_APP_PRIVATE_KEY: TEST_PRIVATE_KEY_PEM,
    });
    expect(workerWithApp.githubApp).toEqual({
      appId: "555",
      installationId: "777",
      privateKeyPem: TEST_PRIVATE_KEY_PEM.trim(),
    });

    const workerWithoutApp = loadWorkerConfig({
      HATCHET_CLIENT_TOKEN: "hatchet-jwt",
    });
    expect(workerWithoutApp.githubApp).toBeUndefined();
  });

  it("rejects partial GitHub App configuration", () => {
    expect(() =>
      loadWorkerConfig({
        HATCHET_CLIENT_TOKEN: "hatchet-jwt",
        GITHUB_APP_ID: "555",
      })
    ).toThrow(/GITHUB_APP/);
  });
});
