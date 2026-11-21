import {
  createServer as createHttpServer,
  request as httpRequest,
} from "node:http";
import type { IncomingHttpHeaders } from "node:http";
import { createConnection, createServer as createTcpServer } from "node:net";
import type { AddressInfo, Server as TcpServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { DnsResolver } from "../src/egress/allowlist.js";
import {
  createEgressProxyServer,
  type DialTarget,
} from "../src/egress/proxy-server.js";
import { createLogger } from "../src/shared/logger.js";

const startTcpEchoServer = async (): Promise<{
  port: number;
  close: () => Promise<void>;
}> =>
  new Promise((resolve, reject) => {
    const server: TcpServer = createTcpServer((socket) => {
      socket.on("data", (chunk) => {
        socket.write(`echo:${chunk.toString("utf8")}`);
      });
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const bound = server.address() as AddressInfo;
      resolve({
        port: bound.port,
        close: () =>
          new Promise<void>((resolveClose) => {
            server.close(() => resolveClose());
          }),
      });
    });
  });

const startUpstreamHttpServer = async (): Promise<{
  port: number;
  received: Array<{
    method: string;
    url: string;
    headers: IncomingHttpHeaders;
    body: string;
  }>;
  close: () => Promise<void>;
}> => {
  const received: Array<{
    method: string;
    url: string;
    headers: IncomingHttpHeaders;
    body: string;
  }> = [];

  const server = createHttpServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      received.push({
        method: request.method ?? "",
        url: request.url ?? "",
        headers: request.headers,
        body,
      });
      const payload = JSON.stringify({
        ok: true,
        hostHeader: request.headers.host,
        path: request.url,
        echoedBody: body,
      });
      response.writeHead(200, {
        "content-type": "application/json",
        "x-upstream-marker": "verified",
      });
      response.end(payload);
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const bound = server.address() as AddressInfo;
      resolve({
        port: bound.port,
        received,
        close: () =>
          new Promise<void>((resolveClose) => {
            server.closeAllConnections();
            server.close(() => resolveClose());
          }),
      });
    });
  });
};

const sendConnectRequest = (
  proxyPort: number,
  authority: string,
  payload?: string
): Promise<{ statusCode: number; echoed?: string }> =>
  new Promise((resolve, reject) => {
    const clientRequest = httpRequest({
      host: "127.0.0.1",
      port: proxyPort,
      method: "CONNECT",
      path: authority,
    });
    clientRequest.once("error", reject);
    clientRequest.once("connect", (response, socket) => {
      const statusCode = response.statusCode ?? 0;
      if (statusCode !== 200 || payload === undefined) {
        socket.destroy();
        resolve({ statusCode });
        return;
      }
      socket.once("data", (chunk) => {
        const echoed = chunk.toString("utf8");
        socket.end();
        resolve({ statusCode, echoed });
      });
      socket.once("error", reject);
      socket.write(payload);
    });
    clientRequest.end();
  });

const sendProxiedHttpRequest = (options: {
  proxyPort: number;
  targetUrl: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<{
  statusCode: number;
  headers: IncomingHttpHeaders;
  body: string;
}> =>
  new Promise((resolve, reject) => {
    const clientRequest = httpRequest(
      {
        host: "127.0.0.1",
        port: options.proxyPort,
        method: options.method ?? "GET",
        path: options.targetUrl,
        headers: options.headers,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );
    clientRequest.once("error", reject);
    if (options.body !== undefined) {
      clientRequest.write(options.body);
    }
    clientRequest.end();
  });

describe("Egress proxy server boundary", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const cleanup = cleanups.pop();
      if (cleanup) {
        await cleanup();
      }
    }
  });

  const startTestProxy = async (options?: {
    resolveDns?: DnsResolver;
    upstreamPort?: number;
  }) => {
    const dialTargets: DialTarget[] = [];
    const clock = () => new Date("2026-11-21T05:00:00.000Z");
    const proxy = createEgressProxyServer({
      resolveDns:
        options?.resolveDns ??
        (async (hostname) => {
          if (hostname === "api.anthropic.com") {
            return [{ address: "160.79.104.10", family: 4 }];
          }
          return [{ address: "104.18.32.7", family: 4 }];
        }),
      dial: (target) => {
        dialTargets.push(target);
        return createConnection({
          host: "127.0.0.1",
          port: options?.upstreamPort ?? 1,
        });
      },
      clock,
      logger: createLogger({
        service: "egress-proxy-test",
        clock,
        write: () => {},
      }),
    });
    const addresses = await proxy.listen({
      proxyPort: 0,
      healthPort: 0,
      host: "127.0.0.1",
    });
    cleanups.push(() => proxy.close());
    return { addresses, dialTargets };
  };

  it("exposes GET /healthz on the dedicated health port and 404 on unknown health routes", async () => {
    const { addresses } = await startTestProxy();

    const healthResponse = await fetch(
      `http://${addresses.health.host}:${addresses.health.port}/healthz`
    );
    const notFoundResponse = await fetch(
      `http://${addresses.health.host}:${addresses.health.port}/other`
    );

    expect(healthResponse.status).toBe(200);
    await expect(healthResponse.json()).resolves.toEqual({
      status: "ok",
      allowlistCount: 2,
      allowedPorts: [80, 443],
    });
    expect(notFoundResponse.status).toBe(404);
  });

  it("tunnels CONNECT for allowlisted domains by dialing the verified resolved IP", async () => {
    const echoServer = await startTcpEchoServer();
    cleanups.push(() => echoServer.close());
    const { addresses, dialTargets } = await startTestProxy({
      upstreamPort: echoServer.port,
    });

    const result = await sendConnectRequest(
      addresses.proxy.port,
      "api.anthropic.com:443",
      "hello-anthropic"
    );

    expect(result).toEqual({
      statusCode: 200,
      echoed: "echo:hello-anthropic",
    });
    expect(dialTargets).toEqual([
      {
        host: "160.79.104.10",
        port: 443,
        family: 4,
        hostname: "api.anthropic.com",
      },
    ]);
  });

  it("rejects CONNECT with 403 for unlisted domains, raw IPs, internal services, disallowed ports, and private DNS answers", async () => {
    const { addresses, dialTargets } = await startTestProxy();
    const blockedAuthorities = [
      "example.com:443",
      "192.168.1.1:443",
      "127.0.0.1:443",
      "[::1]:443",
      "hatchet-lite:443",
      "postgres:443",
      "phoenix:443",
      "webhook-gateway:443",
      "host.docker.internal:443",
      "api.anthropic.com:5432",
      "api.anthropic.com:8888",
    ];

    for (const authority of blockedAuthorities) {
      const result = await sendConnectRequest(addresses.proxy.port, authority);
      expect({ authority, statusCode: result.statusCode }).toEqual({
        authority,
        statusCode: 403,
      });
    }

    const privateDnsTargets = [
      { address: "192.168.1.10", family: 4 as const },
      { address: "100.64.0.5", family: 4 as const },
      { address: "127.0.0.1", family: 4 as const },
      { address: "169.254.169.254", family: 4 as const },
      { address: "fd00::1", family: 6 as const },
    ];

    for (const record of privateDnsTargets) {
      const poisonedProxy = await startTestProxy({
        resolveDns: async () => [record],
      });
      const result = await sendConnectRequest(
        poisonedProxy.addresses.proxy.port,
        "api.anthropic.com:443"
      );
      expect({
        address: record.address,
        statusCode: result.statusCode,
      }).toEqual({
        address: record.address,
        statusCode: 403,
      });
      expect(poisonedProxy.dialTargets).toHaveLength(0);
    }

    expect(dialTargets).toHaveLength(0);
  });

  it("forwards HTTP requests to allowlisted domains via the verified IP and strips hop-by-hop proxy headers", async () => {
    const upstream = await startUpstreamHttpServer();
    cleanups.push(() => upstream.close());
    const { addresses, dialTargets } = await startTestProxy({
      upstreamPort: upstream.port,
    });

    const response = await sendProxiedHttpRequest({
      proxyPort: addresses.proxy.port,
      targetUrl: "http://registry.npmjs.org/-/ping?write=true",
      method: "POST",
      headers: {
        "content-type": "application/json",
        "proxy-authorization": "Basic secret",
        "x-custom": "allowed-header",
      },
      body: JSON.stringify({ package: "zod" }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-upstream-marker"]).toBe("verified");
    expect(JSON.parse(response.body)).toEqual({
      ok: true,
      hostHeader: "registry.npmjs.org",
      path: "/-/ping?write=true",
      echoedBody: JSON.stringify({ package: "zod" }),
    });
    expect(
      upstream.received[0]?.headers["proxy-authorization"]
    ).toBeUndefined();
    expect(upstream.received[0]?.headers["x-custom"]).toBe("allowed-header");
    expect(dialTargets).toEqual([
      {
        host: "104.18.32.7",
        port: 80,
        family: 4,
        hostname: "registry.npmjs.org",
      },
    ]);
  });

  it("rejects HTTP proxy requests with 403 for unlisted domains, private targets, internal services, and disallowed ports", async () => {
    const { addresses, dialTargets } = await startTestProxy();
    const blockedUrls = [
      "http://example.com/",
      "http://192.168.1.1/",
      "http://100.64.0.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/",
      "http://hatchet-lite:80/",
      "http://postgres:80/",
      "http://phoenix:80/",
      "http://webhook-gateway:80/",
      "http://host.docker.internal:80/",
      "http://registry.npmjs.org:8080/",
    ];

    for (const targetUrl of blockedUrls) {
      const response = await sendProxiedHttpRequest({
        proxyPort: addresses.proxy.port,
        targetUrl,
      });
      expect({ targetUrl, statusCode: response.statusCode }).toEqual({
        targetUrl,
        statusCode: 403,
      });
    }

    const originFormResponse = await sendProxiedHttpRequest({
      proxyPort: addresses.proxy.port,
      targetUrl: "/healthz",
    });
    expect(originFormResponse.statusCode).toBe(400);

    const poisonedProxy = await startTestProxy({
      resolveDns: async () => [{ address: "10.0.0.5", family: 4 }],
    });
    const poisonedResponse = await sendProxiedHttpRequest({
      proxyPort: poisonedProxy.addresses.proxy.port,
      targetUrl: "http://registry.npmjs.org/-/ping",
    });
    expect(poisonedResponse.statusCode).toBe(403);
    expect(poisonedProxy.dialTargets).toHaveLength(0);
    expect(dialTargets).toHaveLength(0);
  });
});
