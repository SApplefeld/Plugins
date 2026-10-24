// The relay channel's entry point when the relay arrives as an installed plugin.
//
// A plugin installed from a marketplace runs from a copy of its own directory in Claude Code's
// plugin cache, not from this repository, so this file cannot start the relay itself: relay/index.ts
// imports sibling repository modules and the repository's node_modules, and neither exists beside a
// cached copy. This is a shim instead. It reads the registration the launch wrapper regenerates on
// every launch (wrapper/Enter-ClaudeSession.ps1's New-ChannelMcpConfig writes it from its own
// location) and runs the relay named there, so the machine's live checkout is what serves the
// channel, wherever that checkout has moved to since the plugin was installed.
//
// Plain JavaScript, and nothing outside Node's own builtins: the cache directory has no
// node_modules, no TypeScript tooling, and no install step.
//
// Before it starts the relay, the shim runs the checkout's install/ensure-dependencies.mjs when the
// registration points at a checkout that has one. A plugin update can leave the checkout without its
// node_modules, and a relay that fails to start is skipped by Claude Code for 15 minutes across every
// session on the machine. Restoring them before the relay starts is worth the wait. An install that
// outlasts Claude Code's MCP startup timeout fails that one start, and one cut off there leaves no
// stamp and a lock whose holder is gone, so the next start takes the lock over and installs again.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The key the wrapper registers the relay under, matching this plugin's .mcp.json and plugin.json. */
const SERVER_KEY = "channel-relay";

/**
 * Where the wrapper's generated registration lives, matching broker/config.ts's defaultStateFile
 * and install/Install-Functions.ps1's Get-ChannelStateRoot: one directory holds everything this
 * project writes at runtime. An unset LOCALAPPDATA is refused rather than substituted, because the
 * wrapper refuses to write the registration anywhere else: a fallback path here could only ever
 * name a file that does not exist and misreport where the registration was looked for.
 */
function registrationPath() {
  const base = process.env.LOCALAPPDATA;
  if (!base) {
    fail("LOCALAPPDATA is not set, and the relay registration lives under it.");
  }
  return path.join(base, "sapplefeld-channels", "relay-mcp.json");
}

/**
 * Says why on the way out. A channel server that exits during registration is reported by Claude
 * Code at launch, and that one line is the difference between a fixable message on the screen and a
 * session that looks watched, announces itself, and can never be answered.
 */
function fail(message) {
  process.stderr.write(`channel-relay plugin: ${message}\n`);
  process.exit(1);
}

const source = registrationPath();
let entry;
try {
  const registration = JSON.parse(readFileSync(source, "utf8"));
  entry = registration && registration.mcpServers ? registration.mcpServers[SERVER_KEY] : undefined;
} catch (error) {
  fail(
    `could not read the relay registration at '${source}' (${error.message}). It is written by ` +
      "wrapper/Enter-ClaudeSession.ps1 on every launch, so a session started any other way has no " +
      "relay to point this channel at.",
  );
}

if (!entry || typeof entry.command !== "string" || !Array.isArray(entry.args)) {
  fail(`the relay registration at '${source}' carries no usable '${SERVER_KEY}' command.`);
}

/** A path or name as Windows compares it, case-insensitively; unchanged elsewhere. */
const fold = (value) => (process.platform === "win32" ? value.toLowerCase() : value);

/**
 * The checkout root a registration points at, or undefined for any other shape. The wrapper registers
 * a single argument ending in relay/index.ts, with either separator, and the root is the directory
 * two levels up. Windows paths compare case-insensitively.
 */
function checkoutRoot(args) {
  const first = args[0];
  if (typeof first !== "string") {
    return undefined;
  }
  // Split on either separator, so the folder must be exactly `relay`, not a name ending in it.
  const parts = first.split(/[\\/]/);
  if (parts.length < 3 || fold(parts.at(-1)) !== "index.ts" || fold(parts.at(-2)) !== "relay") {
    return undefined;
  }
  return path.dirname(path.dirname(first));
}

/**
 * Whether `root` resolves inside the marketplace clone this shim's cache copy came from. Claude Code
 * runs the shim from <plugins>/cache/<marketplace>/relay/<version>/launch.mjs and copies it from the
 * clone at <plugins>/marketplaces/<marketplace>, so a checkout inside that clone carries a helper no
 * older than this shim. Any other shape, a missing clone, or a path that cannot be resolved is false,
 * and never fails the launch.
 */
function insideOwnClone(root) {
  const version = path.dirname(fileURLToPath(import.meta.url));
  const plugin = path.dirname(version);
  const marketplace = path.dirname(plugin);
  const cache = path.dirname(marketplace);
  if (fold(path.basename(plugin)) !== "relay" || fold(path.basename(cache)) !== "cache") {
    return false;
  }
  try {
    const clone = fold(realpathSync.native(path.join(path.dirname(cache), "marketplaces", path.basename(marketplace))));
    const checkout = fold(realpathSync.native(root));
    // On a separator boundary, so a clone named with this one's name as a prefix is not inside it.
    return checkout === clone || checkout.startsWith(clone.endsWith(path.sep) ? clone : clone + path.sep);
  } catch {
    return false;
  }
}

// The helper's stdout and stderr both go to this process's stderr: a byte on stdout would corrupt the
// MCP conversation that the relay carries on it. No shell, for the same reason as the spawn below.
// The helper installs into the dependency store beside the registration, under the state root a
// plugin update does not replace, and links the checkout's node_modules to it. The store is passed
// only for a checkout inside this shim's own marketplace clone: a helper that predates the flag
// refuses an unknown option and would stop the relay, and a development checkout heals in place.
const root = checkoutRoot(entry.args);
if (root !== undefined) {
  const helper = path.join(root, "install", "ensure-dependencies.mjs");
  if (existsSync(helper)) {
    const storeArgs = insideOwnClone(root) ? ["--store", path.join(path.dirname(source), "dependencies")] : [];
    const result = spawnSync(process.execPath, [helper, "--root", root, ...storeArgs], {
      stdio: ["ignore", 2, 2],
      shell: false,
      windowsHide: true,
    });
    if (result.error) {
      fail(`could not run the dependency helper '${helper}' (${result.error.message}).`);
    }
    if (result.status !== 0) {
      fail(
        `the dependency helper '${helper}' failed with exit code ${result.status === null ? "none (killed)" : result.status}, ` +
          "so the relay was not started.",
      );
    }
  }
}

// stdio is inherited rather than piped: this process is a pass-through, and the MCP conversation on
// stdin and stdout has to reach the relay byte for byte. No shell, so a checkout path containing a
// space stays one argument instead of becoming a command line to re-parse.
const child = spawn(entry.command, entry.args, { stdio: "inherit", shell: false });

child.on("error", (error) => {
  fail(`could not start the relay with '${entry.command}' (${error.message}).`);
});

// What actually stops the relay on Windows is the inherited stdio: when Claude Code closes its end
// of the pipe, the relay's own transport sees EOF and shuts down, and no signal is involved,
// because Windows terminates a process without delivering SIGTERM to it. The forwarding below
// covers the cases that do run a handler (a console Ctrl+C, and any POSIX host this ever runs on),
// and the exit hook is the belt for a shim that leaves by its own means while the child lives: a
// relay that outlives the session it serves keeps a broker binding open for a session that is gone.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    child.kill(signal);
  });
}
process.on("exit", () => {
  child.kill();
});

child.on("exit", (code, signal) => {
  // A child killed by a signal reports no exit code. Non-zero there keeps it distinct from the clean
  // shutdown, which is the only difference the caller can act on.
  process.exit(signal ? 1 : code === null ? 1 : code);
});
