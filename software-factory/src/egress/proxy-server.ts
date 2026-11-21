import { createServer, request as httpRequest } from "node:http";
import type {
  IncomingMessage,
  RequestOptions,
  Server,
  ServerResponse,
} from "node:http";
import { createConnection } from "node:net";
import type { Socket } from "node:net";
import type { Duplex } from "node:stream";
import type { Logger } from "../shared/logger.js";
import { createLogger } from "../shared/logger.js";
import type { Clock } from "../shared/types.js";
import {
  authorizeEgressTarget,
  DEFAULT_ALLOWED_PORTS,
  DEFAULT_ALLOWLIST_DOMAINS,
  defaultDnsResolver,
  type DnsResolver,
  type EgressPolicy,
} from "./allowlist.js";
import {
  filterForwardHeaders,
  parseConnectAuthority,
  parseProxyHttpUrl,
  type ParsedHttpTarget,
  sendJson,
  writeSocketErrorResponse,
} from "./http-helpers.js";

const SOCKET_IDLE_TIMEOUT_MS = 60_000;

export type DialTarget = {
  host: string;
  port: number;
  family: 4 | 6;
  hostname: string;
};

export type TcpDialer = (target: DialTarget) => Socket;

export type EgressProxyServerOptions = {
  policy?: Partial<EgressPolicy>;
  resolveDns?: DnsResolver;
  dial?: TcpDialer;
  clock?: Clock;
  logger?: Logger;
};

export type BoundAddress = {
  host: string;
  port: number;
};

export type EgressProxyAddresses = {
  proxy: BoundAddress;
  health: BoundAddress;
};

export type EgressProxyListenOptions = {
  proxyPort: number;
  healthPort: number;
  host?: string;
};

export type EgressProxyServer = {
  listen: (options: EgressProxyListenOptions) => Promise<EgressProxyAddresses>;
  close: () => Promise<void>;
};

type ProxyRuntime = {
  policy: EgressPolicy;
  resolveDns: DnsResolver;
  dial: TcpDialer;
  logger: Logger;
};

type ConnectContext = {
  request: IncomingMessage;
  clientSocket: Duplex;
  head: Buffer;
};

type AuthorizedHttpForward = {
  target: ParsedHttpTarget;
  resolvedIp: string;
  family: 4 | 6;
  hostname: string;
};

const defaultTcpDialer: TcpDialer = (target) =>
  createConnection({
    host: target.host,
    port: target.port,
    family: target.family,
  });

const wireTunnelSockets = (
  clientSocket: Duplex,
  upstreamSocket: Socket,
  head: Buffer
): void => {
  let established = false;

  upstreamSocket.setTimeout(SOCKET_IDLE_TIMEOUT_MS, () => {
    upstreamSocket.destroy();
  });

  upstreamSocket.once("connect", () => {
    established = true;
    if (clientSocket.destroyed || !clientSocket.writable) {
      upstreamSocket.destroy();
      return;
    }
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length > 0) {
      upstreamSocket.write(head);
    }
    upstreamSocket.pipe(clientSocket);
    clientSocket.pipe(upstreamSocket);
  });

  upstreamSocket.once("error", () => {
    if (!established) {
      writeSocketErrorResponse(clientSocket, 502, "upstream_connect_failed");
      return;
    }
    clientSocket.destroy();
  });

  clientSocket.once("error", () => upstreamSocket.destroy());
  clientSocket.once("close", () => upstreamSocket.destroy());
};

const denyConnect = (
  runtime: ProxyRuntime,
  clientSocket: Duplex,
  details: { statusCode: number; reason: string; host?: string; port?: number }
): void => {
  runtime.logger.warn("egress.denied", { method: "CONNECT", ...details });
  writeSocketErrorResponse(clientSocket, details.statusCode, details.reason);
};

const handleConnectRequest = async (
  runtime: ProxyRuntime,
  connectContext: ConnectContext
): Promise<void> => {
  const parsed = parseConnectAuthority(connectContext.request.url);
  if (parsed === null) {
    denyConnect(runtime, connectContext.clientSocket, {
      statusCode: 400,
      reason: "invalid_connect_authority",
      host: connectContext.request.url,
    });
    return;
  }

  const authorization = await authorizeEgressTarget({
    host: parsed.host,
    port: parsed.port,
    policy: runtime.policy,
    resolveDns: runtime.resolveDns,
  });
  if (!authorization.allowed) {
    denyConnect(runtime, connectContext.clientSocket, {
      host: parsed.host,
      port: parsed.port,
      statusCode: authorization.statusCode,
      reason: authorization.reason,
    });
    return;
  }

  runtime.logger.info("egress.allowed", {
    method: "CONNECT",
    hostname: authorization.hostname,
    port: authorization.port,
    resolvedIp: authorization.resolvedIp,
    family: authorization.family,
  });

  const upstreamSocket = runtime.dial({
    host: authorization.resolvedIp,
    port: authorization.port,
    family: authorization.family,
    hostname: authorization.hostname,
  });
  wireTunnelSockets(
    connectContext.clientSocket,
    upstreamSocket,
    connectContext.head
  );
};

const buildUpstreamRequestOptions = (
  runtime: ProxyRuntime,
  forward: AuthorizedHttpForward,
  request: IncomingMessage
): RequestOptions => ({
  host: forward.resolvedIp,
  port: forward.target.port,
  family: forward.family,
  method: request.method,
  path: forward.target.path,
  headers: filterForwardHeaders(request.headers, forward.target.hostHeader),
  createConnection: () =>
    runtime.dial({
      host: forward.resolvedIp,
      port: forward.target.port,
      family: forward.family,
      hostname: forward.hostname,
    }),
});

const pipeAuthorizedHttpRequest = (
  runtime: ProxyRuntime,
  forward: AuthorizedHttpForward,
  io: { request: IncomingMessage; response: ServerResponse }
): Promise<void> =>
  new Promise((resolve) => {
    const requestOptions = buildUpstreamRequestOptions(
      runtime,
      forward,
      io.request
    );
    const upstreamRequest = httpRequest(requestOptions, (upstreamResponse) => {
      io.response.writeHead(
        upstreamResponse.statusCode ?? 502,
        filterForwardHeaders(upstreamResponse.headers)
      );
      upstreamResponse.pipe(io.response);
      upstreamResponse.once("end", resolve);
    });

    upstreamRequest.setTimeout(SOCKET_IDLE_TIMEOUT_MS, () => {
      upstreamRequest.destroy(new Error("Upstream request timeout"));
    });
    upstreamRequest.once("error", () => {
      if (!io.response.headersSent) {
        sendJson(io.response, 502, {
          error: "Egress upstream error",
          reason: "upstream_request_failed",
        });
      } else {
        io.response.destroy();
      }
      resolve();
    });
    io.request.once("aborted", () => {
      upstreamRequest.destroy();
      resolve();
    });
    io.request.pipe(upstreamRequest);
  });

const denyHttp = (
  runtime: ProxyRuntime,
  response: ServerResponse,
  details: {
    method?: string;
    host?: string;
    port?: number;
    statusCode: number;
    reason: string;
  }
): void => {
  runtime.logger.warn("egress.denied", details);
  sendJson(response, details.statusCode, {
    error: "Egress blocked",
    reason: details.reason,
  });
};

const forwardHttpRequest = async (
  runtime: ProxyRuntime,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> => {
  const target = parseProxyHttpUrl(request.url);
  if (target === null) {
    denyHttp(runtime, response, {
      method: request.method,
      host: request.url,
      statusCode: 400,
      reason: "invalid_proxy_url",
    });
    return;
  }

  const authorization = await authorizeEgressTarget({
    host: target.host,
    port: target.port,
    policy: runtime.policy,
    resolveDns: runtime.resolveDns,
  });
  if (!authorization.allowed) {
    denyHttp(runtime, response, {
      method: request.method,
      host: target.host,
      port: target.port,
      statusCode: authorization.statusCode,
      reason: authorization.reason,
    });
    return;
  }

  runtime.logger.info("egress.allowed", {
    method: request.method,
    hostname: authorization.hostname,
    port: authorization.port,
    resolvedIp: authorization.resolvedIp,
    family: authorization.family,
  });

  await pipeAuthorizedHttpRequest(
    runtime,
    {
      target,
      resolvedIp: authorization.resolvedIp,
      family: authorization.family,
      hostname: authorization.hostname,
    },
    { request, response }
  );
};

const bindHttpServer = (
  server: Server,
  port: number,
  host: string
): Promise<BoundAddress> =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const bound = server.address();
      if (!bound || typeof bound === "string") {
        reject(new Error("Failed to resolve bound server address"));
        return;
      }
      resolve({ host: bound.address, port: bound.port });
    });
  });

const closeHttpServer = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.closeAllConnections();
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

const createHealthServer = (policy: EgressPolicy): Server =>
  createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (request.method === "GET" && pathname === "/healthz") {
      sendJson(response, 200, {
        status: "ok",
        allowlistCount: policy.allowlistDomains.length,
        allowedPorts: [...policy.allowedPorts],
      });
      return;
    }
    sendJson(response, 404, { error: "Not found" });
  });

const createForwardProxyServer = (runtime: ProxyRuntime): Server => {
  const proxyServer: Server = createServer((request, response) => {
    void forwardHttpRequest(runtime, request, response).catch(() => {
      if (!response.headersSent) {
        sendJson(response, 502, {
          error: "Egress upstream error",
          reason: "proxy_internal_error",
        });
      }
    });
  });

  proxyServer.on("connect", (request, clientSocket, head) => {
    void handleConnectRequest(runtime, { request, clientSocket, head }).catch(
      () => {
        writeSocketErrorResponse(clientSocket, 502, "proxy_internal_error");
      }
    );
  });

  return proxyServer;
};

export const createEgressProxyServer = (
  options: EgressProxyServerOptions = {}
): EgressProxyServer => {
  const clock = options.clock ?? (() => new Date());
  const policy: EgressPolicy = {
    allowlistDomains: options.policy?.allowlistDomains ?? [
      ...DEFAULT_ALLOWLIST_DOMAINS,
    ],
    allowedPorts: options.policy?.allowedPorts ?? [...DEFAULT_ALLOWED_PORTS],
  };
  const runtime: ProxyRuntime = {
    policy,
    resolveDns: options.resolveDns ?? defaultDnsResolver,
    dial: options.dial ?? defaultTcpDialer,
    logger: options.logger ?? createLogger({ service: "egress-proxy", clock }),
  };

  const proxyServer = createForwardProxyServer(runtime);
  const healthServer = createHealthServer(policy);

  return {
    listen: async (listenOptions) => {
      const host = listenOptions.host ?? "0.0.0.0";
      const proxy = await bindHttpServer(
        proxyServer,
        listenOptions.proxyPort,
        host
      );
      try {
        const health = await bindHttpServer(
          healthServer,
          listenOptions.healthPort,
          host
        );
        return { proxy, health };
      } catch (error: unknown) {
        await closeHttpServer(proxyServer);
        throw error;
      }
    },
    close: async () => {
      await Promise.all([
        closeHttpServer(proxyServer),
        closeHttpServer(healthServer),
      ]);
    },
  };
};
