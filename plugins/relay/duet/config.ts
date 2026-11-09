// Configuration for the Duet server, the read-only MCP process that runs beside the broker. The
// values arrive from the broker's own environment file: the `CHANNEL_DUET_*` keys are the server's
// own, and the `CHANNEL_WEB_*` keys the approval listener's gate needs are the web surface's,
// resolved as `broker/web/config.ts` resolves them, so the approval page binds where the operator's
// pages bind and admits whom they admit. As there, the environment is read in one place and the
// checks run on values, so a test reaches every refusal without an environment.
import os from "node:os";
import path from "node:path";
import { DEFAULT_WEB_PORT } from "../broker/config.ts";
import { resolveWebBind } from "../broker/web/config.ts";
import type { WebConfigContext } from "../broker/web/config.ts";

/** The public port Funnel forwards to, on loopback. */
export const DEFAULT_DUET_PORT = 8790;
/** The approval listener's port, on the tailnet bind. */
export const DEFAULT_APPROVE_PORT = 8791;
/** The one callback Claude's connector sends a browser back to. */
export const DEFAULT_REDIRECT_URIS: readonly string[] = ["https://claude.ai/api/mcp/auth_callback"];
/** Anthropic's published egress range, the only source a machine call is admitted from. */
export const DEFAULT_CLIENT_RANGES: readonly string[] = ["160.79.104.0/21"];
/** The state file's name, beside the broker's own. */
export const DUET_STATE_FILE_NAME = "duet-state.json";
/** The path under the public URL the MCP endpoint answers on, and the `resource` every grant names. */
export const MCP_PATH = "/mcp";

/** An IPv4 network in CIDR form, the address as an unsigned 32-bit integer and the prefix length. */
export type Cidr = {
  /** The range as the operator wrote it, for a log line or a refusal. */
  text: string;
  /** The network address with the host bits cleared. */
  network: number;
  /** The prefix length, 0 to 32. */
  bits: number;
};

export type DuetConfig = {
  /** The loopback port the public listener binds. */
  port: number;
  /** The node's HTTPS origin, scheme and host alone with no trailing slash, as the issuer. */
  publicUrl: string;
  /** `<publicUrl>/mcp`, the protected resource every authorization request must name. */
  mcpUrl: string;
  /** The redirect URIs a registration may name, each an exact string. */
  redirectUris: readonly string[];
  /** The source ranges a machine call is admitted from. */
  clientRanges: readonly Cidr[];
  /** Absolute path of the state file. */
  stateFile: string;
  /** The broker's web port, where the tools read the views from, on the approval listener's bind. */
  webPort: number;
  /** The approval listener: where it binds and whom it admits. */
  approve: ApproveConfig;
};

/** The approval listener's gate values, the web surface's own, read the same way. */
export type ApproveConfig = {
  /** What `CHANNEL_WEB_BIND` says: an IPv4 address, or the literal `tailscale`. */
  configuredBind: string;
  /** The resolved tailnet address, or null while the literal is pending. */
  bind: string | null;
  port: number;
  /** Tailnet logins admitted, lower-cased, at least one. */
  operators: readonly string[];
  /** Tailnet node names admitted, lower-cased, or null when the node is not checked. */
  devices: readonly string[] | null;
  /** The Tailscale CLI, a path or a name on PATH. */
  tailscale: string;
};

/** The environment's values, read once by `readDuetValues` and checked by `loadDuetConfig`. */
export type DuetConfigValues = {
  enabled: boolean;
  port: number;
  approvePort: number;
  publicUrl: string | null;
  redirectUris: readonly string[];
  clientRanges: readonly string[];
  stateFile: string;
  webBind: string | null;
  webPort: number;
  webOperators: readonly string[];
  webDevices: readonly string[] | null;
  webTailscale: string;
};

const DEFAULT_WEB_TAILSCALE = "tailscale";

/** True for `1`, `true`, `yes` or `on` in any case, as the installer writes the switch. */
function switchOn(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

/** An integer at least `minimum`, or the fallback for an unset or blank value; anything else refuses. */
function integerAtLeast(key: string, raw: string | undefined, minimum: number, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${key} expects an integer of at least ${String(minimum)}, got ${JSON.stringify(raw)}`);
  }
  return value;
}

/**
 * A comma-separated list as the web surface's lists are read: each entry trimmed, empty entries
 * dropped, and null for an unset or empty value.
 */
function list(raw: string | undefined): readonly string[] | null {
  if (raw === undefined || raw.trim() === "") return null;
  const entries = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  return entries.length === 0 ? null : entries;
}

/**
 * The broker's state file, as `broker/config.ts` resolves it: `CHANNEL_BROKER_STATE`, or
 * `broker-state.json` under `sapplefeld-channels` in the local application data folder. The Duet
 * state file sits beside it by default, so the install protects both under one folder.
 */
function brokerStateFile(env: NodeJS.ProcessEnv): string {
  const configured = env.CHANNEL_BROKER_STATE?.trim();
  if (configured !== undefined && configured !== "") return configured;
  const base = env.LOCALAPPDATA ?? os.homedir();
  return path.join(base, "sapplefeld-channels", "broker-state.json");
}

/** The environment's values, defaults applied and nothing checked past integer shape. */
export function readDuetValues(env: NodeJS.ProcessEnv): DuetConfigValues {
  return {
    enabled: switchOn(env.CHANNEL_DUET_ENABLED),
    port: integerAtLeast("CHANNEL_DUET_PORT", env.CHANNEL_DUET_PORT, 1, DEFAULT_DUET_PORT),
    approvePort: integerAtLeast("CHANNEL_DUET_APPROVE_PORT", env.CHANNEL_DUET_APPROVE_PORT, 1, DEFAULT_APPROVE_PORT),
    publicUrl: env.CHANNEL_DUET_PUBLIC_URL?.trim() || null,
    redirectUris: list(env.CHANNEL_DUET_REDIRECT_URIS) ?? DEFAULT_REDIRECT_URIS,
    clientRanges: list(env.CHANNEL_DUET_CLIENT_RANGES) ?? DEFAULT_CLIENT_RANGES,
    stateFile: env.CHANNEL_DUET_STATE?.trim() || path.join(path.dirname(brokerStateFile(env)), DUET_STATE_FILE_NAME),
    webBind: env.CHANNEL_WEB_BIND?.trim() || null,
    webPort: integerAtLeast("CHANNEL_WEB_PORT", env.CHANNEL_WEB_PORT, 1, DEFAULT_WEB_PORT),
    webOperators: list(env.CHANNEL_WEB_OPERATORS) ?? [],
    webDevices: list(env.CHANNEL_WEB_DEVICES),
    webTailscale: env.CHANNEL_WEB_TAILSCALE?.trim() || DEFAULT_WEB_TAILSCALE,
  };
}

const OCTET = /^(0|[1-9][0-9]{0,2})$/;

/** A dotted-quad IPv4 address as an unsigned 32-bit integer, or null for anything else. */
export function parseIPv4(address: string): number | null {
  const octets = address.trim().split(".");
  if (octets.length !== 4) return null;
  let value = 0;
  for (const octet of octets) {
    if (!OCTET.test(octet)) return null;
    const n = Number(octet);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

/** The mask for a prefix length, as an unsigned 32-bit integer; 0 bits is 0, 32 bits is all ones. */
function maskOf(bits: number): number {
  return bits === 0 ? 0 : (0xffff_ffff << (32 - bits)) >>> 0;
}

/**
 * One `address/bits` range, or a thrown refusal naming the rule. Only IPv4 is read: Funnel hands
 * the public listener an IPv4 `X-Forwarded-For` for Anthropic's range, and an IPv6 range here would
 * admit nothing the gate can match. The host bits are cleared, so `160.79.105.0/21` names the same
 * network as `160.79.104.0/21`.
 */
export function parseCidr(text: string): Cidr {
  const trimmed = text.trim();
  const slash = trimmed.indexOf("/");
  if (slash < 0) throw new Error(`range ${JSON.stringify(trimmed)} has no prefix length`);
  const address = parseIPv4(trimmed.slice(0, slash));
  if (address === null) throw new Error(`range ${JSON.stringify(trimmed)} is not an IPv4 address with a prefix length`);
  const prefix = trimmed.slice(slash + 1);
  if (!/^(0|[1-9][0-9]?)$/.test(prefix) || Number(prefix) > 32) {
    throw new Error(`range ${JSON.stringify(trimmed)} has a prefix length outside 0 to 32`);
  }
  const bits = Number(prefix);
  return { text: trimmed, network: (address & maskOf(bits)) >>> 0, bits };
}

/** True where `address` is a dotted-quad IPv4 inside one of the ranges; anything else is outside. */
export function inRanges(address: string, ranges: readonly Cidr[]): boolean {
  const value = parseIPv4(address);
  if (value === null) return false;
  return ranges.some((range) => ((value & maskOf(range.bits)) >>> 0) === range.network);
}

/**
 * The public URL as an origin: `https`, a host, no path past `/`, no query, fragment or credentials.
 * The issuer and every endpoint are built from it, and a stray path would put the metadata documents
 * somewhere Claude does not look.
 */
function publicOrigin(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`CHANNEL_DUET_PUBLIC_URL must be an https URL, got ${JSON.stringify(raw)}`);
  }
  const bare = url.pathname === "/" || url.pathname === "";
  if (url.protocol !== "https:" || !bare || url.search !== "" || url.hash !== "" || url.username !== "" || url.password !== "") {
    throw new Error(
      `CHANNEL_DUET_PUBLIC_URL must be an https URL with a host and no path, got ${JSON.stringify(raw)}`,
    );
  }
  return url.origin;
}

/** A redirect URI the allowlist may hold: an absolute `https` URL with no fragment. */
function redirectUri(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`CHANNEL_DUET_REDIRECT_URIS entry ${JSON.stringify(raw)} is not a URL`);
  }
  if (url.protocol !== "https:" || url.hash !== "") {
    throw new Error(`CHANNEL_DUET_REDIRECT_URIS entry ${JSON.stringify(raw)} must be an https URL with no fragment`);
  }
  return raw;
}

function port(key: string, value: number): number {
  if (value > 65_535) throw new Error(`${key} must be at most 65535, got ${String(value)}`);
  return value;
}

/**
 * The configuration, or null while `CHANNEL_DUET_ENABLED` is off, which is every host that has not
 * installed Duet. With it on, every other key is checked here, before a listener opens: the public
 * URL, the allowlist and the ranges are what the gates compare against, and a malformed value would
 * otherwise admit nothing or the wrong thing silently. The approval listener needs the web surface's
 * bind and lists, since the operator approves a sign-in from the devices that reach the pages.
 */
export function loadDuetConfig(values: DuetConfigValues, context: WebConfigContext = {}): DuetConfig | null {
  if (!values.enabled) return null;

  if (values.publicUrl === null) {
    throw new Error("CHANNEL_DUET_PUBLIC_URL must be set when CHANNEL_DUET_ENABLED is on");
  }
  const publicUrl = publicOrigin(values.publicUrl);

  if (values.redirectUris.length === 0) {
    throw new Error("CHANNEL_DUET_REDIRECT_URIS must name at least one callback, or no client could register");
  }
  const redirectUris = values.redirectUris.map(redirectUri);

  if (values.clientRanges.length === 0) {
    throw new Error("CHANNEL_DUET_CLIENT_RANGES must name at least one range, or no client could call");
  }
  const clientRanges = values.clientRanges.map((range) => {
    try {
      return parseCidr(range);
    } catch (error) {
      throw new Error(`CHANNEL_DUET_CLIENT_RANGES ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  if (!path.isAbsolute(values.stateFile)) {
    throw new Error(`CHANNEL_DUET_STATE must be an absolute path, got ${JSON.stringify(values.stateFile)}`);
  }

  if (values.webBind === null) {
    throw new Error("CHANNEL_WEB_BIND must be set when CHANNEL_DUET_ENABLED is on, since the approval page binds there");
  }
  const bind = resolveWebBind(values.webBind, values.webTailscale, context);
  const operators = values.webOperators.map((login) => login.toLowerCase());
  if (operators.length === 0) {
    throw new Error("CHANNEL_WEB_OPERATORS must name at least one tailnet login, or the approval page would admit nobody");
  }
  const devices = values.webDevices === null ? null : values.webDevices.map((node) => node.toLowerCase());

  const duetPort = port("CHANNEL_DUET_PORT", values.port);
  const approvePort = port("CHANNEL_DUET_APPROVE_PORT", values.approvePort);
  if (duetPort === approvePort) {
    throw new Error(`CHANNEL_DUET_PORT and CHANNEL_DUET_APPROVE_PORT must differ, both are ${String(duetPort)}`);
  }
  const webPort = port("CHANNEL_WEB_PORT", values.webPort);

  return {
    port: duetPort,
    publicUrl,
    mcpUrl: `${publicUrl}${MCP_PATH}`,
    redirectUris,
    clientRanges,
    stateFile: values.stateFile,
    webPort,
    approve: {
      configuredBind: values.webBind,
      bind,
      port: approvePort,
      operators,
      devices,
      tailscale: values.webTailscale,
    },
  };
}
