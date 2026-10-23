// Who is on the other end of a web surface connection. The answer is the tailnet's, read through
// `tailscale whois --json <addr>`, which names the login and the node behind a peer address;
// there is no token to leak and no password to rotate. Every failure on this path is a refusal:
// a CLI that is missing, errors, hangs or answers something this module cannot read yields null,
// and null is 403 at the listener, never an admit and never a crash.
import { execFile, execFileSync } from "node:child_process";

export type TailnetPeer = {
  /** The tailnet login, as `UserProfile.LoginName` reports it. */
  login: string;
  /** The node's short name, as `Node.ComputedName` reports it. */
  node: string;
};

/** One method: the peer behind an address, or null for anyone the tailnet cannot name. */
export type WebIdentity = {
  peerFor(address: string): Promise<TailnetPeer | null>;
};

/**
 * True only for a dotted-quad IPv4 address inside 100.64.0.0/10, the block Tailscale assigns
 * every node from. The second octet carries the /10: 100.64 through 100.127 are inside, 100.63 and
 * 100.128 are out. Anything that is not four decimal octets is outside, so an IPv6 literal, a
 * hostname and an empty string all fail closed, and so does an octet with a leading zero, which a
 * socket may read as octal. Shared by the bind check in config.ts and the argument screen below, so
 * the two cannot drift.
 */
export function isTailnetAddress(address: string): boolean {
  const octets = address.trim().split(".");
  if (octets.length !== 4) return false;
  if (!octets.every((octet) => /^(0|[1-9]\d{0,2})$/.test(octet) && Number(octet) <= 255)) return false;
  const second = Number(octets[1]);
  return octets[0] === "100" && second >= 64 && second <= 127;
}

/**
 * How long one address's answer stands before the CLI is asked again. An answer that names nobody
 * stands this long too. An address the tailnet cannot name is no answer: the CLI exits non-zero
 * with "peer not found", and that failure takes the shorter hold below.
 */
export const WHOIS_CACHE_MS = 60_000;

/**
 * How long a spawn that failed is held, counted from the failure: long enough that a failing CLI
 * is not asked once per request, short enough that one hiccup does not lock the operator out for
 * a minute.
 */
export const WHOIS_ERROR_CACHE_MS = 5_000;
/** How long the CLI may take before its answer is a refusal. */
const CLI_TIMEOUT_MS = 5_000;
/** The most output read from the CLI; a whois answer is a few kilobytes. */
const CLI_MAX_OUTPUT_BYTES = 64 * 1024;
/**
 * The most addresses whose answers are held at once. The oldest entry goes when the cap is
 * reached, so a run of connections from many addresses costs memory bounded here rather than by
 * the run.
 */
const CACHE_CAP = 1_024;

/**
 * The spawn, shared by the two CLI calls and taking the command as an argument array with no
 * shell, so an address or a path reaches the CLI as one argument and nothing in it is interpreted.
 * Bounded in time and in output: a CLI that hangs or floods is an error, which the callers read as
 * a refusal.
 */
function runCli(cli: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      cli,
      args,
      {
        encoding: "utf8",
        timeout: CLI_TIMEOUT_MS,
        maxBuffer: CLI_MAX_OUTPUT_BYTES,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error !== null) reject(error);
        else resolve(stdout);
      },
    );
  });
}

/**
 * The login and node out of a `tailscale whois --json` answer, or null for anything else.
 *
 * The answer is Tailscale's `WhoIsResponse`: `UserProfile.LoginName` is the login the node is
 * signed in under, and `Node.ComputedName` is the node's short MagicDNS name, the one the admin
 * console lists and the operator writes into `CHANNEL_WEB_DEVICES`. `Node.Name` carries the same
 * name as a fully qualified, dot-terminated hostname, so where a CLI answers without
 * `ComputedName` its first label is read instead. A missing or empty login or node is null: an
 * answer this cannot read names nobody.
 */
export function parseWhois(text: string): TailnetPeer | null {
  let answer: unknown;
  try {
    answer = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof answer !== "object" || answer === null || Array.isArray(answer)) return null;
  const fields = answer as Record<string, unknown>;
  const profile = fields.UserProfile;
  const node = fields.Node;
  if (typeof profile !== "object" || profile === null) return null;
  if (typeof node !== "object" || node === null) return null;
  const login = (profile as Record<string, unknown>).LoginName;
  if (typeof login !== "string" || login.trim() === "") return null;
  const computed = (node as Record<string, unknown>).ComputedName;
  const fullName = (node as Record<string, unknown>).Name;
  let name: string | null = null;
  if (typeof computed === "string" && computed.trim() !== "") {
    name = computed.trim();
  } else if (typeof fullName === "string" && fullName.trim() !== "") {
    name = fullName.trim().split(".")[0];
  }
  if (name === null || name === "") return null;
  return { login: login.trim(), node: name };
}

export type TailscaleIdentityOptions = {
  /** The CLI, a path or a name on PATH. */
  cli: string;
  /** Drives the cache's expiry. Injected so a test moves time without sleeping. */
  now?: () => number;
  /** The spawn, injected so a test reaches every answer the CLI can give without the CLI. */
  run?: (cli: string, args: readonly string[]) => Promise<string>;
};

/**
 * The production resolver: one `whois` per address per `WHOIS_CACHE_MS` for any answer the CLI
 * gives, and per `WHOIS_ERROR_CACHE_MS` after a spawn that failed. A page polling every five
 * seconds costs one spawn a minute, and a refused address cannot make the listener spawn once per
 * request. The promise is what is cached, so two requests arriving together from one address
 * share one spawn.
 */
export function createTailscaleIdentity(options: TailscaleIdentityOptions): WebIdentity {
  const now = options.now ?? Date.now;
  const run = options.run ?? runCli;
  const cache = new Map<string, { expires: number; answer: Promise<TailnetPeer | null> }>();

  return {
    peerFor(address) {
      // Screened before it becomes an argument: a listener bound inside the tailnet range is
      // connected to from that range alone, so an address outside it, or one that is not an
      // address at all, has no peer to look up and never reaches the spawn.
      if (!isTailnetAddress(address)) return Promise.resolve(null);
      const at = now();
      const held = cache.get(address);
      if (held !== undefined && at < held.expires) return held.answer;
      // Deleted first so the re-set key moves to the end, and the cap evicts the quietest address.
      cache.delete(address);
      if (cache.size >= CACHE_CAP) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      const entry = { expires: at + WHOIS_CACHE_MS, answer: Promise.resolve<TailnetPeer | null>(null) };
      entry.answer = run(options.cli, ["whois", "--json", address]).then(parseWhois, () => {
        // The error is discarded: it names the CLI path and the address, both already known to the
        // caller, and a refusal line is written there with the address alone.
        // Counted from the failure, not the request: a CLI that runs to its timeout fails when a
        // hold counted from the request would already be over.
        entry.expires = now() + WHOIS_ERROR_CACHE_MS;
        return null;
      });
      cache.set(address, entry);
      return entry.answer;
    },
  };
}

/**
 * The host's own first tailnet IPv4, from `tailscale ip -4`, or null where the CLI is missing,
 * fails, or prints nothing inside the range. Synchronous and run once, at configuration load, for
 * the literal `tailscale` in `CHANNEL_WEB_BIND` alone.
 */
export function tailnetAddress(cli: string): string | null {
  let output: string;
  try {
    output = execFileSync(cli, ["ip", "-4"], {
      encoding: "utf8",
      timeout: CLI_TIMEOUT_MS,
      maxBuffer: CLI_MAX_OUTPUT_BYTES,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
  const first = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line !== "");
  if (first === undefined || !isTailnetAddress(first)) return null;
  return first;
}
