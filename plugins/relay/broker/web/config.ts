// Configuration for the web surface, the broker's second listener. Absent configuration is a
// supported state, not an error: with CHANNEL_WEB_BIND unset the broker is its loopback listener
// alone, which is what every test and every host that has not installed Tailscale runs.
//
// Where this departs from broker/discord/config.ts: the values arrive already read from the
// environment by broker/config.ts, never as the environment itself, so the installer's env
// allowlist pin, which scans that one file for the knobs it must carry, sees all six.
import path from "node:path";
import { namesOneDirectory } from "../config.ts";
import type { BrokerConfig } from "../config.ts";
import { isTailnetAddress, tailnetAddress } from "./identity.ts";

/** A root's name as a request addresses it: compared without regard to case. */
export function foldRootName(name: string): string {
  return name.toLowerCase();
}

export type WebConfig = {
  /** The IPv4 address the listener binds, always inside 100.64.0.0/10, the literal resolved. */
  bind: string;
  port: number;
  /** Tailnet logins admitted, lower-cased, at least one. */
  operators: readonly string[];
  /** Tailnet node names admitted, lower-cased, or null when the node is not checked. */
  devices: readonly string[] | null;
  /** The Tailscale CLI, a path or a name on PATH. */
  tailscale: string;
  /** Absolute path of the directory pages are served from. */
  staticRoot: string;
};

/**
 * The values `loadConfig` reads for this surface: its six knobs, and the project root list, which
 * the page addresses by last folder name.
 */
export type WebConfigValues = Pick<
  BrokerConfig,
  | "webBind"
  | "webPort"
  | "webOperators"
  | "webDevices"
  | "webTailscale"
  | "webStaticRoot"
  | "boardProjects"
>;

export type WebConfigContext = {
  /**
   * How the literal `tailscale` becomes an address: the host's first tailnet IPv4, or null where
   * the CLI reports none. Injected so a test reaches the literal's two outcomes without the CLI,
   * which no test host has; the default runs `tailscale ip -4`.
   */
  tailnetAddress?: (cli: string) => string | null;
};

/** The one spelling of the bind that is resolved rather than taken as an address. */
const RESOLVE_LITERAL = "tailscale";

/** Returns null when `CHANNEL_WEB_BIND` is unset, which turns the surface off. */
export function loadWebConfig(
  values: WebConfigValues,
  context: WebConfigContext = {},
): WebConfig | null {
  if (values.webBind === null) return null;

  // Resolved before it is checked, so the literal and a written address are held to the same
  // range rule: a CLI answering with something outside the block is refused like a typo would be.
  let bind = values.webBind;
  if (bind === RESOLVE_LITERAL) {
    const resolve = context.tailnetAddress ?? tailnetAddress;
    const resolved = resolve(values.webTailscale);
    if (resolved === null) {
      throw new Error(
        `CHANNEL_WEB_BIND is "${RESOLVE_LITERAL}" but the CLI at ${values.webTailscale} reported no ` +
          "tailnet IPv4 address; is Tailscale installed and up on this host?",
      );
    }
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

  return {
    bind,
    port: values.webPort,
    operators,
    devices,
    tailscale: values.webTailscale,
    staticRoot: values.webStaticRoot,
  };
}
