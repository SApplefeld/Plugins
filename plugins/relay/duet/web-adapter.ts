// The bridge between Node's `http` and the web standard `Request` and `Response`, so the SDK's web
// standard transport answers on the listener's own socket. It is the project's own, because the
// SDK's Node transport does the same through hono's Node adapter, which this process never loads.
// Inbound, the request's method, headers and body become a `Request`: the body is read whole under
// a ceiling through the authorization server's `readBody`, since every MCP message is one JSON
// document and the ceiling is where an oversized post stops. Outbound, the `Response` is written to
// the socket as it arrives: the status and headers first, then each chunk of the body as the stream
// yields it, which is what an SSE answer needs, with the client's disconnect cancelling the stream.
import type { IncomingMessage, ServerResponse } from "node:http";
import { readBody } from "./oauth.ts";

export type WebRequestOptions = {
  /** The absolute URL the `Request` carries; the caller names it, so nothing of the request's `Host` is parsed. */
  url: string;
  /** The body ceiling in bytes; a body past it hands back null. */
  ceiling: number;
};

/** Methods that carry no body, so nothing is read. */
const BODILESS = new Set(["GET", "HEAD", "DELETE", "OPTIONS"]);

/** The request's headers as a `Headers`, each repeated header appended in turn. */
function headersOf(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const each of value) headers.append(name, each);
    } else {
      headers.append(name, value);
    }
  }
  return headers;
}

/**
 * The request as a web `Request`, or null where the body ran past the ceiling or the request closed
 * before its body arrived. A null means the caller answers, since nothing of the body was kept.
 */
export async function toWebRequest(request: IncomingMessage, options: WebRequestOptions): Promise<Request | null> {
  const method = request.method ?? "GET";
  const headers = headersOf(request);
  if (BODILESS.has(method)) {
    request.resume();
    return new Request(options.url, { method, headers });
  }
  const body = await readBody(request, options.ceiling);
  if (body === null) return null;
  // The body is a copy of the Buffer's bytes, so the Request owns what it carries.
  return new Request(options.url, { method, headers, body: new Uint8Array(body) });
}

/** The response's headers as the shape `writeHead` takes. */
function headersFor(web: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  web.headers.forEach((value, name) => {
    headers[name] = value;
  });
  return headers;
}

/**
 * Writes one chunk and resolves once the socket has taken it, or at once where the socket is gone,
 * so a slow or vanished client never holds the pump on a `drain` that will not come.
 */
function written(response: ServerResponse, chunk: Uint8Array): Promise<void> {
  return new Promise((resolve) => {
    if (response.destroyed) {
      resolve();
      return;
    }
    if (response.write(chunk)) {
      resolve();
      return;
    }
    const settle = (): void => {
      response.off("drain", settle);
      response.off("close", settle);
      resolve();
    };
    response.on("drain", settle);
    response.on("close", settle);
  });
}

/**
 * Writes the web `Response` to the socket: the status and headers, then the body as its stream
 * yields it, ending the response when the stream ends. A client that goes away mid-stream cancels
 * the stream, so the transport learns the stream is gone and stops writing to it.
 */
export async function sendWebResponse(response: ServerResponse, web: Response): Promise<void> {
  response.writeHead(web.status, headersFor(web));
  if (web.body === null) {
    response.end();
    return;
  }
  const reader = web.body.getReader();
  const cancel = (): void => {
    void reader.cancel().catch(() => {});
  };
  // A client gone before the listener is attached raises no `close` for it, so it cancels here.
  if (response.destroyed) cancel();
  response.on("close", cancel);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || response.destroyed) break;
      await written(response, value);
    }
  } finally {
    response.off("close", cancel);
    reader.releaseLock();
    response.end();
  }
}
