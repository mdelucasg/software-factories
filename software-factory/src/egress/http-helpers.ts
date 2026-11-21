import type {
  IncomingHttpHeaders,
  OutgoingHttpHeaders,
  ServerResponse,
} from "node:http";
import type { Duplex } from "node:stream";

const HOP_BY_HOP_HEADERS: ReadonlySet<string> = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "upgrade",
]);

const STATUS_TEXT: Record<number, string> = {
  400: "Bad Request",
  403: "Forbidden",
  502: "Bad Gateway",
};

export type ParsedHttpTarget = {
  host: string;
  port: number;
  path: string;
  hostHeader: string;
};

export const sendJson = (
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

export const writeSocketErrorResponse = (
  clientSocket: Duplex,
  statusCode: number,
  reason: string
): void => {
  if (clientSocket.destroyed || !clientSocket.writable) {
    return;
  }
  const label = STATUS_TEXT[statusCode] ?? "Error";
  const body = `Egress blocked: ${reason}\n`;
  clientSocket.end(
    `HTTP/1.1 ${statusCode} ${label}\r\n` +
      "Content-Type: text/plain; charset=utf-8\r\n" +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      "Connection: close\r\n\r\n" +
      body
  );
};

export const parseConnectAuthority = (
  rawAuthority: string | undefined
): { host: string; port: number } | null => {
  if (!rawAuthority || rawAuthority.trim().length === 0) {
    return null;
  }
  const authority = rawAuthority.trim();
  if (authority.startsWith("[")) {
    const bracketEnd = authority.indexOf("]:");
    if (bracketEnd === -1) {
      return null;
    }
    const portText = authority.slice(bracketEnd + 2);
    if (!/^\d+$/.test(portText)) {
      return null;
    }
    return { host: authority.slice(0, bracketEnd + 1), port: Number(portText) };
  }

  const colonIndex = authority.lastIndexOf(":");
  if (colonIndex <= 0) {
    return null;
  }
  const portText = authority.slice(colonIndex + 1);
  if (!/^\d+$/.test(portText)) {
    return null;
  }
  return { host: authority.slice(0, colonIndex), port: Number(portText) };
};

export const parseProxyHttpUrl = (
  rawUrl: string | undefined
): ParsedHttpTarget | null => {
  if (!rawUrl || !rawUrl.toLowerCase().startsWith("http://")) {
    return null;
  }
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" || parsed.hostname.length === 0) {
      return null;
    }
    const port = parsed.port.length > 0 ? Number(parsed.port) : 80;
    return {
      host: parsed.hostname,
      port,
      path: `${parsed.pathname}${parsed.search}`,
      hostHeader: parsed.host,
    };
  } catch {
    return null;
  }
};

export const filterForwardHeaders = (
  incomingHeaders: IncomingHttpHeaders,
  hostHeader?: string
): OutgoingHttpHeaders => {
  const filtered: OutgoingHttpHeaders = {};
  for (const [name, headerValue] of Object.entries(incomingHeaders)) {
    if (headerValue === undefined) {
      continue;
    }
    if (HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
      continue;
    }
    filtered[name] = headerValue;
  }
  if (hostHeader !== undefined) {
    filtered.host = hostHeader;
  }
  return filtered;
};
