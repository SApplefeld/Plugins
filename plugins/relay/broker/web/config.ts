// Configuration for the web surface, the broker's second listener. Absent configuration is a
// supported state, not an error: with CHANNEL_WEB_BIND unset the broker is its loopback listener
// alone, which is what every test and every host that has not installed Tailscale runs.
//
// Where this departs from broker/discord/config.ts: the values arrive already read from the
// environment by broker/config.ts, never as the environment itself, so the installer's env
// allowlist pin, which scans that one file for the knobs it must carry, sees all eight.
import path from "node:path";
import { namesOneDirectory } from "../config.ts";
import type { BrokerConfig } from "../config.ts";
import { isTailnetAddress, tailnetAddress } from "./identity.ts";

/** A root's name as a request addresses it: compared without regard to case. */
export function foldRootName(name: string): string {
  return name.toLowerCase();
}

/** One sibling sandbox the broker polls: the name the rail draws, and where its web listener is. */
export type Sibling = {
  /** The configured name, 1 to 32 characters, drawn on every page as written here. */
  name: string;
  /** The sibling's tailnet IPv4 address, inside 100.64.0.0/10. */
  address: string;
  port: number;
};

export type WebConfig = {
  /** What `CHANNEL_WEB_BIND` says: an IPv4 address, or the literal `tailscale`. */
  configuredBind: string;
  /**
   * The IPv4 address the listener binds, always inside 100.64.0.0/10, the literal resolved; null
   * while the literal is pending, where the CLI reported no address yet. The broker resolves it
   * again at each bind attempt.
   */
  bind: string | null;
  port: number;
  /** Tailnet logins admitted, lower-cased, at least one. */
  operators: readonly string[];
  /** Tailnet node names admitted, lower-cased, or null when the node is not checked. */
  devices: readonly string[] | null;
  /**
   * Tailnet node names admitted to `GET /web/summary` alone, lower-cased; empty where none is set.
   * The listener's gate reads it only beside a device list, since with none every node under an
   * admitted login is admitted everywhere already.
   */
  summaryPeers: readonly string[];
  /** The Tailscale CLI, a path or a name on PATH. */
  tailscale: string;
  /** Absolute path of the directory pages are served from. */
  staticRoot: string;
  /** The sibling sandboxes polled for the rail, in the configured order; empty where none is set. */
  siblings: readonly Sibling[];
};

/**
 * The values `loadConfig` reads for this surface: its eight knobs, and the project root list, which
 * the page addresses by last folder name.
 */
export type WebConfigValues = Pick<
  BrokerConfig,
  | "webBind"
  | "webPort"
  | "webOperators"
  | "webDevices"
  | "webSummaryPeers"
  | "webTailscale"
  | "webStaticRoot"
  | "webSiblings"
  | "boardProjects"
>;

/** The most siblings one broker polls; the program names three sandboxes. */
export const MAX_SIBLINGS = 8;
/** The longest sibling name, the summary's own bound on a sandbox name. */
const SIBLING_NAME_MAX = 32;
/** A control character in a name: C0, DEL and C1. The sibling poll holds a sibling's own name to it too. */
export const CONTROL_CHAR = /[\u0000-\u001f\u007f-\u009f]/;
const PORT_SHAPE = /^[0-9]{1,5}$/;

/**
 * The `Name=address:port` entries of `CHANNEL_WEB_SIBLINGS`, one `Sibling` each, or a thrown
 * refusal naming the key, the entry's position and the rule, never the entry: a name or an address
 * off the shape is still an operator's text and stays out of the log. The address is held to the
 * tailnet range by the same check the bind takes, since the poller sends a request to each address
 * and an address outside the range would send it anywhere.
 */
function parseSiblings(entries: readonly string[]): Sibling[] {
  const refuse = (position: number, rule: string): never => {
    throw new Error(`CHANNEL_WEB_SIBLINGS entry ${String(position)} ${rule}`);
  };
  if (entries.length > MAX_SIBLINGS) {
    refuse(MAX_SIBLINGS + 1, `is one too many: at most ${String(MAX_SIBLINGS)} siblings are polled`);
  }
  const siblings: Sibling[] = [];
  const seen = new Map<string, number>();
  entries.forEach((entry, index) => {
    const position = index + 1;
    const equals = entry.indexOf("=");
    if (equals < 0) refuse(position, "is not of the form Name=address:port");
    if (entry.includes("=", equals + 1)) refuse(position, "holds more than one equals sign");
    const name = entry.slice(0, equals).trim();
    const where = entry.slice(equals + 1).trim();
    if (name.length === 0 || name.length > SIBLING_NAME_MAX) {
      refuse(position, `has a name outside 1 to ${String(SIBLING_NAME_MAX)} characters`);
    }
    if (name.includes(",") || CONTROL_CHAR.test(name)) {
      refuse(position, "has a name holding a comma or a control character");
    }
    const colon = where.lastIndexOf(":");
    if (colon < 0) refuse(position, "has no port after the address");
    const address = where.slice(0, colon).trim();
    const port = where.slice(colon + 1);
    if (!isTailnetAddress(address)) refuse(position, "has an address outside 100.64.0.0/10");
    if (!PORT_SHAPE.test(port) || Number(port) < 1 || Number(port) > 65_535) {
      refuse(position, "has a port outside 1 to 65535");
    }
    const earlier = seen.get(foldRootName(name));
    if (earlier !== undefined) refuse(position, `repeats the name of entry ${String(earlier)}`);
    seen.set(foldRootName(name), position);
    siblings.push({ name, address, port: Number(port) });
  });
  return siblings;
}

export type WebConfigContext = {
  /**
   * How the literal `tailscale` becomes an address: the host's first tailnet IPv4, or null where
   * the CLI reports none. Injected so a test reaches the literal's two outcomes without the CLI,
   * which no test host has; the default runs `tailscale ip -4`.
   */
  tailnetAddress?: (cli: string) => string | null;
};

/** The one spelling of the bind that is resolved rather than taken as an address. */
export const RESOLVE_LITERAL = "tailscale";

/**
 * The address a configured bind names now: a written address as it stands, or the literal
 * `tailscale` resolved through `context.tailnetAddress`, null where it reports no address yet. The
 * default resolver reads a CLI answer outside the tailnet range as no address, so the literal stays
 * pending rather than refused. A written address outside the range or malformed throws, naming the
 * key, and so does a resolver's answer outside it. Run at configuration load and again at each bind
 * attempt, so a host whose tailnet comes up after the broker binds once it does.
 */
export function resolveWebBind(configured: string, cli: string, context: WebConfigContext = {}): string | null {
  // Resolved before it is checked, so a resolver's answer is held to the same range rule a written
  // address is, whichever resolver gave it.
  let bind = configured;
  if (bind === RESOLVE_LITERAL) {
    const resolve = context.tailnetAddress ?? tailnetAddress;
    const resolved = resolve(cli);
    if (resolved === null) return null;
    bind = resolved;
  }
  // The range is the whole of the guarantee that the surface is reachable from the tailnet alone:
  // loopback, a LAN address and a public interface are all outside it, so the listener can never
  // be opened where the identity check does not apply.
  if (!isTailnetAddress(bind)) {
    throw new Error(
      `CHANNEL_WEB_BIND must be an IPv4 address in 100.64.0.0/10 or the literal ` +
        `"${RESOLVE_LITERAL}", got ${JSON.stringify(bind)}`,
    );
  }
  return bind;
}

/** The bind a log line names: the resolved address, or the configured word while it is pending. */
export function webBindLabel(web: Pick<WebConfig, "bind" | "configuredBind">): string {
  return web.bind ?? web.configuredBind;
}

/** Returns null when `CHANNEL_WEB_BIND` is unset, which turns the surface off. */
export function loadWebConfig(
  values: WebConfigValues,
  context: WebConfigContext = {},
): WebConfig | null {
  if (values.webBind === null) return null;

  // A literal the CLI cannot resolve yet loads as a pending bind rather than a refusal: Tailscale
  // may come up after the broker at boot, and the broker binds once it does.
  const bind = resolveWebBind(values.webBind, values.webTailscale, context);

  // Lower-cased once here, and the peer's values once at the check, so a login written with the
  // provider's capitals still matches what `tailscale whois` reports.
  const operators = values.webOperators.map((login) => login.toLowerCase());
  if (operators.length === 0) {
    throw new Error(
      "CHANNEL_WEB_OPERATORS must name at least one tailnet login when CHANNEL_WEB_BIND is set, " +
        "or the listener would admit nobody",
    );
  }
  const devices = values.webDevices === null ? null : values.webDevices.map((node) => node.toLowerCase());
  const summaryPeers = values.webSummaryPeers.map((node) => node.toLowerCase());

  // Refused here rather than at the bind, which runs after the broker has logged in to Discord.
  if (values.webPort > 65_535) {
    throw new Error(`CHANNEL_WEB_PORT must be at most 65535, got ${String(values.webPort)}`);
  }

  // Held to the project-root rule: a relative root resolves against whatever directory the
  // scheduled task was given, and a page served from the wrong tree is a 404 on every route.
  if (!namesOneDirectory(values.webStaticRoot)) {
    throw new Error(
      `CHANNEL_WEB_STATIC_ROOT must be an absolute path, got ${JSON.stringify(values.webStaticRoot)}`,
    );
  }

  // A root is addressed by its last folder name in a request, so two roots sharing one would answer
  // for each other. The page names a root without regard to case, so the fold is the same one a
  // request's name is matched under.
  const named = new Map<string, string>();
  for (const root of values.boardProjects) {
    const name = foldRootName(path.basename(root));
    const earlier = named.get(name);
    if (earlier !== undefined) {
      throw new Error(
        `CHANNEL_BOARD_PROJECTS holds two roots with the last folder name "${name}" when ` +
          `CHANNEL_WEB_BIND is set: "${earlier}" and "${root}"`,
      );
    }
    named.set(name, root);
  }

  const siblings = parseSiblings(values.webSiblings);

  return {
    configuredBind: values.webBind,
    bind,
    port: values.webPort,
    operators,
    devices,
    summaryPeers,
    tailscale: values.webTailscale,
    staticRoot: values.webStaticRoot,
    siblings,
  };
}
