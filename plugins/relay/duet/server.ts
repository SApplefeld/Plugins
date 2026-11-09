// The MCP server the public listener answers with: a name, a version, and whatever the register
// function puts on it, which is the tools and nothing else. No resource and no prompt is registered
// here or anywhere under `duet/`, so the capabilities the server advertises are the tools alone. The
// listener builds one server per request, since the stateless transport it uses is one request's,
// so the builder is cheap and holds no state of its own.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/** The name and version the server answers `initialize` with. */
export const SERVER_INFO = { name: "sapplefeld-channels-duet", version: "0.1.0" } as const;

/** Puts the tools on a server; section 3's `duet/tools.ts` is the one the process passes. */
export type RegisterTools = (server: McpServer) => void;

/** A server carrying what `register` put on it and nothing else. */
export function createMcpServer(register: RegisterTools): McpServer {
  const server = new McpServer(SERVER_INFO);
  register(server);
  return server;
}
