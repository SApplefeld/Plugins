// The Duet server's entry point: the read-only MCP process that runs beside the broker under its
// own scheduled task, `install/Start-Duet.ps1`, reading the broker's own environment file. It wires
// the store, the OAuth routes, the approval page and the tools, and opens the two listeners: the
// public one on loopback, which Funnel forwards the node's HTTPS name to, and the approval one on
// the broker's tailnet bind.
//
// The public listener opens first, at process start, so the loopback port Funnel forwards the
// node's HTTPS name to is this process's before anything is awaited: a port left free while the
// address is awaited could be bound by another account on the host, which would then receive the
// tokens Claude sends. The approval page binds where the operator's pages bind, and every tool reads
// the broker's views at that same address, so until the tailnet address is held an admitted MCP
// message answers 503 and the OAuth routes and the range gate answer as they always do. The bind is
// retried as the broker retries its own web surface: the address is not available at boot before
// Tailscale is up, and the literal `tailscale` is resolved again at each attempt.
import { runDirectly } from "../broker/entrypoint.ts";
import path from "node:path";
import { WEB_BIND_RETRY_MS, loadConfig, readWebReaderKey } from "../broker/config.ts";
import type { BrokerConfig } from "../broker/config.ts";
import { createLogger } from "../broker/log.ts";
import type { Logger } from "../broker/log.ts";
import { RESOLVE_LITERAL, resolveWebBind, webBindLabel } from "../broker/web/config.ts";
import { createTailscaleIdentity, tailnetAddressAsync } from "../broker/web/identity.ts";
import { createApproveServer } from "./approve.ts";
import { loadDuetConfig, readDuetValues } from "./config.ts";
import type { DuetConfig } from "./config.ts";
import { createOauthHandlers } from "./oauth.ts";
import { createPublicServer } from "./public.ts";
import type { RegisterTools } from "./server.ts";
import { createStore } from "./store.ts";
import type { DuetStore } from "./store.ts";
import { createRegisterTools } from "./tools.ts";

/**
 * Whether a bind failed because the host does not hold the address yet, the one bind failure that
 * is waited out. Every other code is final: `EADDRINUSE` is a second Duet or a foreign process on
 * the port, and no retry frees it. The broker keeps the same rule for its web surface.
 */
function addressNotAvailable(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "EADDRNOTAVAIL";
}

/**
 * The broker's log, so the Duet lines land beside the broker's own under the `duet:` prefix each
 * carries. The file and its rotation are read as the broker reads them, from the same three keys,
 * through the broker's own loader rather than a second copy of its defaults. Under the task there
 * is no console, so with no file configured the lines reach only a hand run's console.
 */
function brokerLogger(broker: BrokerConfig): Logger {
  return createLogger({ file: broker.logFile, maxBytes: broker.logMaxBytes, maxFiles: broker.logMaxFiles });
}

export type DuetProcess = {
  /** Closes both listeners and cancels a pending bind retry. Safe to call before either is open. */
  stop: () => Promise<void>;
};

/**
 * Starts the server over a loaded configuration and resolves once the public listener is open and
 * the first bind attempt has settled: bound, waiting for the address, or failed. A final failure,
 * a state file that cannot be loaded among them, is logged and ends the process with 1 through
 * `exit`, since a Duet whose state, approval page or public endpoint cannot open has nothing to
 * serve. The scheduled task starts it again within two minutes.
 */
export async function startDuet(
  config: DuetConfig,
  readerKey: string,
  log: Logger,
  options: { exit?: (code: number) => void } = {},
): Promise<DuetProcess> {
  const exit = options.exit ?? ((code: number): void => process.exit(code));
  const note = (message: string): void => {
    console.log(message);
    log.info(message);
  };
  const fail = (message: string): void => {
    console.error(message);
    log.error(message);
  };

  // The state file's refusals name the rule and never the contents, and a server that cannot load
  // its clients and tokens has nothing to serve.
  let store: DuetStore;
  try {
    store = createStore({ file: config.stateFile });
  } catch (error) {
    fail(`duet: refused to start: ${error instanceof Error ? error.message : String(error)}`);
    exit(1);
    return { stop: () => Promise.resolve() };
  }
  const oauth = createOauthHandlers({ config, store });
  const identity = createTailscaleIdentity({ cli: config.approve.tailscale });
  const approve = createApproveServer({ config: config.approve, identity, store, log });
  // The tools, built once the address they read the broker at is held; until then the public
  // listener answers an admitted MCP message 503.
  let tools: RegisterTools | null = null;
  const publicServer = createPublicServer({
    config,
    oauth,
    store,
    register: (server) => tools?.(server),
    ready: () => tools !== null,
    log,
  });
  let retry: NodeJS.Timeout | null = null;
  let attempt: Promise<void> | null = null;
  let stopping: Promise<void> | null = null;

  const waitForAddress = (): void => {
    if (stopping !== null) return;
    retry = setTimeout(() => {
      retry = null;
      attempt = bind();
    }, WEB_BIND_RETRY_MS);
  };

  // One attempt, which ends bound, waiting again, or with one failure line and the process ending,
  // never in a throw: a retry runs inside a timer with no caller to throw to. The literal is
  // resolved through the CLI run without blocking, and a CLI answer that is missing or outside the
  // tailnet range is no address yet. An attempt that settles after a stop has begun does nothing
  // more; the stop waits for it and closes the listeners.
  async function bind(): Promise<void> {
    const approvePort = String(config.approve.port);
    let address: string | null = null;
    try {
      const answer =
        config.approve.configuredBind === RESOLVE_LITERAL ? await tailnetAddressAsync(config.approve.tailscale) : null;
      if (stopping !== null) return;
      address = resolveWebBind(config.approve.configuredBind, config.approve.tailscale, { tailnetAddress: () => answer });
      if (address === null) {
        waitForAddress();
        return;
      }
      await approve.listen(address);
    } catch (error) {
      if (stopping !== null) return;
      if (addressNotAvailable(error)) {
        waitForAddress();
        return;
      }
      fail(`duet: failed to start the approval listener on ${address ?? config.approve.configuredBind}:${approvePort}: ${String(error)}`);
      exit(1);
      return;
    }
    if (stopping !== null) return;

    // The tools read the broker's views at the address just bound, on the broker's web port, with
    // the reader key the broker admits this node by, and the public listener serves them from now.
    tools = createRegisterTools({ bind: address, port: config.webPort, readerKey });
    note(
      `duet: listening for ${config.publicUrl} on http://127.0.0.1:${String(config.port)}, approval page on ` +
        `http://${address}:${approvePort}, reading the broker at http://${address}:${String(config.webPort)}, ` +
        `state at ${config.stateFile}`,
    );
  }

  const stop = (): Promise<void> => {
    if (stopping !== null) return stopping;
    stopping = (async (): Promise<void> => {
      if (retry !== null) {
        clearTimeout(retry);
        retry = null;
      }
      if (attempt !== null) await attempt;
      await approve.close();
      await publicServer.close();
    })();
    return stopping;
  };

  // The public port is held before the address is awaited; a bind failure here, `EADDRINUSE` from a
  // second Duet or a foreign process among them, is final, as the approval listener's is.
  try {
    await publicServer.listen();
  } catch (error) {
    fail(`duet: failed to start the public listener on 127.0.0.1:${String(config.port)}: ${String(error)}`);
    exit(1);
    return { stop };
  }
  attempt = bind();
  await attempt;
  if (stopping === null && retry !== null) {
    const message =
      `duet: waiting for ${webBindLabel(config.approve)}:${String(config.approve.port)}, the address is not ` +
      `available yet; retrying every ${String(WEB_BIND_RETRY_MS / 1000)} seconds`;
    console.warn(message);
    log.warn(message);
  }
  return { stop };
}

async function main(): Promise<void> {
  let log: Logger | null = null;
  let config: DuetConfig | null;
  let readerKey: string;
  try {
    const broker = loadConfig(process.env);
    log = brokerLogger(broker);
    config = loadDuetConfig(readDuetValues(process.env));
    if (config === null) {
      // Every host without Duet installed: the task is not registered there, and a hand run says
      // why it did nothing.
      console.log("duet: CHANNEL_DUET_ENABLED is off; exiting.");
      return;
    }
    // The key the broker admits this node's view reads by, read by the broker's own rule. Without
    // it every tool would be refused, so its absence is a refusal to start like any other.
    readerKey = readWebReaderKey(broker.webReaderKeyFile, path.dirname(broker.stateFile));
  } catch (error) {
    // The configuration's refusals name the key and the rule, and a server that cannot load them
    // has nothing to serve. Logged, since under the task nothing reads the console. A refusal of the
    // broker's own keys comes before the log exists, so that one reaches stderr alone.
    const message = `duet: refused to start: ${error instanceof Error ? error.message : String(error)}`;
    console.error(message);
    log?.error(message);
    process.exitCode = 1;
    return;
  }

  // A stop under a signal ends the process with 0, whichever listener state it lands in: a task
  // stopping the server is never answered with a failure.
  let signalled = false;
  const duet = await startDuet(config, readerKey, log, { exit: (code) => process.exit(signalled ? 0 : code) });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      signalled = true;
      void duet.stop().then(() => process.exit(0));
    });
  }
}

if (runDirectly(import.meta.url)) {
  await main();
}
