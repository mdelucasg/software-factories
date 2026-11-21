import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { WorkflowDispatcher } from "../orchestrator/ports.js";
import type { Logger } from "../shared/logger.js";
import { createLogger } from "../shared/logger.js";
import type { Clock, FactoryRunInput } from "../shared/types.js";
import { routeGitHubWebhookEvent } from "./route-event.js";
import { verifyWebhookSignature } from "./verify-signature.js";

const MAX_BODY_BYTES = 1024 * 1024;

export type WebhookServerOptions = {
  webhookSecret: string;
  dispatcher: WorkflowDispatcher;
  clock?: Clock;
  logger?: Logger;
};

export type WebhookServerAddress = {
  host: string;
  port: number;
};

export type WebhookServer = {
  listen: (port: number, host?: string) => Promise<WebhookServerAddress>;
  close: () => Promise<void>;
};

const sendJson = (
  response: ServerResponse,
  statusCode: number,
  body: Record<string, unknown>
): void => {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
};

const resolveRequestPath = (request: IncomingMessage): string => {
  const rawUrl = request.url ?? "/";
  return new URL(rawUrl, "http://127.0.0.1").pathname;
};

const readSingleHeader = (
  request: IncomingMessage,
  name: string
): string | undefined => {
  const headerValue = request.headers[name.toLowerCase()];
  return Array.isArray(headerValue) ? headerValue[0] : headerValue;
};

const readRawBody = (request: IncomingMessage): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    request.on("data", (chunk: Buffer | string) => {
      const bufferChunk =
        typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
      totalBytes += bufferChunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        request.destroy();
        reject(new Error("Payload too large"));
        return;
      }
      chunks.push(bufferChunk);
    });

    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });

const parseJsonPayload = (
  rawBody: Buffer
): { ok: true; value: unknown } | { ok: false } => {
  try {
    return { ok: true, value: JSON.parse(rawBody.toString("utf8")) };
  } catch {
    return { ok: false };
  }
};

const bindServer = (
  server: Server,
  port: number,
  host: string
): Promise<WebhookServerAddress> =>
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

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

type WebhookHandlerContext = {
  webhookSecret: string;
  dispatcher: WorkflowDispatcher;
  clock: Clock;
  logger: Logger;
};

const dispatchWorkflow = async (
  handlerContext: WebhookHandlerContext,
  runInput: FactoryRunInput,
  response: ServerResponse
): Promise<void> => {
  try {
    const result = await handlerContext.dispatcher.dispatch(runInput);
    handlerContext.logger.info("webhook.dispatched", {
      deliveryId: runInput.deliveryId,
      workflow: runInput.workflow,
      concurrencyKey: runInput.concurrencyKey,
      runId: result.runId,
    });
    sendJson(response, 202, {
      status: "dispatched",
      runId: result.runId,
      workflow: runInput.workflow,
      concurrencyKey: runInput.concurrencyKey,
    });
  } catch (error: unknown) {
    handlerContext.logger.error("webhook.dispatch_failed", {
      deliveryId: runInput.deliveryId,
      workflow: runInput.workflow,
      error: error instanceof Error ? error.message : String(error),
    });
    sendJson(response, 502, { error: "Failed to dispatch workflow" });
  }
};

const handleWebhookPost = async (
  handlerContext: WebhookHandlerContext,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> => {
  const rawBody = await readRawBody(request);
  const deliveryId =
    readSingleHeader(request, "x-github-delivery") ?? randomUUID();
  const isValid = verifyWebhookSignature({
    rawBody,
    signatureHeader: readSingleHeader(request, "x-hub-signature-256"),
    secret: handlerContext.webhookSecret,
  });

  if (!isValid) {
    handlerContext.logger.warn("webhook.signature_invalid", { deliveryId });
    sendJson(response, 401, { error: "Invalid webhook signature" });
    return;
  }

  const parsedJson = parseJsonPayload(rawBody);
  if (!parsedJson.ok) {
    handlerContext.logger.warn("webhook.invalid_json", { deliveryId });
    sendJson(response, 400, { error: "Invalid JSON payload" });
    return;
  }

  const routeResult = routeGitHubWebhookEvent({
    eventName: readSingleHeader(request, "x-github-event"),
    deliveryId,
    payload: parsedJson.value,
    receivedAt: handlerContext.clock().toISOString(),
  });

  if (routeResult.kind === "invalid") {
    handlerContext.logger.warn("webhook.invalid_payload", {
      deliveryId,
      reason: routeResult.reason,
    });
    sendJson(response, 400, { error: routeResult.reason });
    return;
  }

  if (routeResult.kind === "ignore") {
    handlerContext.logger.info("webhook.ignored", {
      deliveryId,
      reason: routeResult.reason,
    });
    sendJson(response, 200, { status: "ignored", reason: routeResult.reason });
    return;
  }

  await dispatchWorkflow(handlerContext, routeResult.runInput, response);
};

export const createWebhookServer = (
  options: WebhookServerOptions
): WebhookServer => {
  const clock = options.clock ?? (() => new Date());
  const logger =
    options.logger ?? createLogger({ service: "webhook-gateway", clock });
  const handlerContext: WebhookHandlerContext = {
    webhookSecret: options.webhookSecret,
    dispatcher: options.dispatcher,
    clock,
    logger,
  };

  const handleRequest = async (
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> => {
    const pathname = resolveRequestPath(request);
    if (request.method === "GET" && pathname === "/healthz") {
      sendJson(response, 200, { status: "ok" });
      return;
    }
    if (request.method === "POST" && pathname === "/webhooks/github") {
      await handleWebhookPost(handlerContext, request, response);
      return;
    }
    logger.warn("webhook.route_not_found", {
      method: request.method,
      pathname,
    });
    sendJson(response, 404, { error: "Not found" });
  };

  const server: Server = createServer((request, response) => {
    void handleRequest(request, response).catch((error: unknown) => {
      logger.error("webhook.unhandled_error", {
        error: error instanceof Error ? error.message : String(error),
      });
      if (!response.headersSent) {
        sendJson(response, 500, { error: "Internal server error" });
      }
    });
  });

  return {
    listen: (port, host = "0.0.0.0") => bindServer(server, port, host),
    close: () => closeServer(server),
  };
};
