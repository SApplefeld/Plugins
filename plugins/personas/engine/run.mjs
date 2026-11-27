// run.mjs: the engine stand-in's entry, for one persona.
//
//   node run.mjs --engine <name> --persona <name> --workdir <dir> --rundir <dir>
//     --child-dir <dir> --store-file <file> --model <name>
//     [--options-file <file>] [--script <file>]
//
// --persona is required and --script is optional, and each is passed to the
// host. The host does not read --persona: the persona the module runs as is
// the options file's `persona`. It hands --script to the adapter, and the
// adapter `scripted` plays that file.
//
// Five more arguments are for tests alone, and shorten the host's timing
// bounds, its bound on a model call that names no time limit and its
// heartbeat's period so a suite can meet each rule in milliseconds:
// --test-start-bound-ms, --test-silence-bound-ms, --test-interrupt-wait-ms,
// --test-heartbeat-ms and --test-complete-bound-ms. Each takes a whole
// number of milliseconds from 1 to 2147483647 and is refused otherwise. No
// engine, model, tool input or options file reaches them.
//
// It refuses a node older than 23.6, an unknown or missing argument, a
// --child-dir or a --store-file inside --workdir, and a --store-file that
// names no file on disk, each with exit code 2 and one sentence on stderr,
// before anything is loaded or written. For the inside check each path is
// resolved with realpath from its nearest existing folder, the part that
// does not exist yet joined back on, so a junction or a symbolic link cannot
// hide one folder inside the other; case is ignored on Windows, and a path
// equal to the working directory is inside it. The store module reads a
// missing file as an empty store, so without the store check a wrong path
// would start a store no other persona reads. That check is one stat, tried
// again while it draws a busy code, as the store's own read is.
//
// Then it registers the resolve hook that adds ".ts" to an extensionless
// relative import made from a file under plugins/personas, which is how the
// hooks module imports its siblings, imports the adapters the stand-in
// ships, each of which registers itself, and imports ./host.ts. A start that
// fails ends with exit code 2 and its own sentence, written here once the
// host's wind-down is over.

import { realpathSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const NODE_FLOOR = [23, 6];

const REQUIRED = ["engine", "persona", "workdir", "rundir", "child-dir", "store-file", "model"];
const OPTIONAL = ["options-file", "script"];
// The test-only bounds, by argument and the host's name for each.
const TEST_BOUNDS = { "test-start-bound-ms": "startMs", "test-silence-bound-ms": "silenceMs", "test-interrupt-wait-ms": "interruptWaitMs", "test-heartbeat-ms": "heartbeatMs", "test-complete-bound-ms": "completeMs" };
const TIMER_MAX_MS = 2_147_483_647;

// The store read's busy retry, mcp/file-store.ts's BUSY_CODES, BUSY_RETRIES
// and BUSY_RETRY_MS.
const BUSY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
const BUSY_RETRIES = 10;
const BUSY_RETRY_MS = 20;

function refuse(sentence) {
  process.stderr.write(`engine stand-in: ${sentence}\n`);
  process.exit(2);
}

function nodeTooOld(version) {
  const [major, minor] = version.replace(/^v/, "").split(".").map(Number);
  return major < NODE_FLOOR[0] || (major === NODE_FLOOR[0] && minor < NODE_FLOOR[1]);
}

function parseArgs(argv) {
  const known = new Set([...REQUIRED, ...OPTIONAL, ...Object.keys(TEST_BOUNDS)]);
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const name = flag.startsWith("--") ? flag.slice(2) : "";
    if (!known.has(name)) refuse(`${JSON.stringify(flag)} is not an argument this entry takes.`);
    if (Object.hasOwn(args, name)) refuse(`--${name} is given more than once.`);
    const value = argv[i + 1];
    if (value === undefined || value === "") refuse(`--${name} is given no value.`);
    args[name] = value;
  }
  const missing = REQUIRED.filter((name) => !Object.hasOwn(args, name));
  if (missing.length > 0) refuse(`the required argument${missing.length > 1 ? "s" : ""} ${missing.map((name) => `--${name}`).join(", ")} ${missing.length > 1 ? "are" : "is"} missing.`);
  for (const name of Object.keys(TEST_BOUNDS)) {
    if (!Object.hasOwn(args, name)) continue;
    const ms = Number(args[name]);
    if (!/^[0-9]+$/.test(args[name]) || !Number.isSafeInteger(ms) || ms < 1 || ms > TIMER_MAX_MS) refuse(`--${name} is not a whole number of milliseconds from 1 to ${TIMER_MAX_MS}.`);
  }
  return args;
}

// The host's bounds the test-only arguments shorten, or undefined where none
// was given.
function boundsOf(args) {
  const bounds = {};
  for (const [name, key] of Object.entries(TEST_BOUNDS)) if (Object.hasOwn(args, name)) bounds[key] = Number(args[name]);
  return Object.keys(bounds).length > 0 ? bounds : undefined;
}

// `target` with every link resolved: realpath of its nearest existing
// folder, with the part below it that does not exist yet joined back on.
function realPathOf(target) {
  let head = path.resolve(target);
  const tail = [];
  for (;;) {
    try {
      return path.join(realpathSync.native(head), ...tail);
    } catch (err) {
      if (err?.code !== "ENOENT" && err?.code !== "ENOTDIR") throw err;
      const parent = path.dirname(head);
      if (parent === head) return path.join(head, ...tail);
      tail.unshift(path.basename(head));
      head = parent;
    }
  }
}

// Refuses a --child-dir or a --store-file inside --workdir, or equal to it,
// each path resolved by realPathOf and compared with case ignored on Windows.
function refuseInsideWorkdir(args) {
  const fold = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
  const real = (name) => {
    try {
      return fold(realPathOf(args[name]));
    } catch (err) {
      refuse(`--${name} could not be resolved (${err?.code ?? "error"}).`);
    }
  };
  const workdir = real("workdir");
  const within = workdir.endsWith(path.sep) ? workdir : `${workdir}${path.sep}`;
  for (const name of ["child-dir", "store-file"]) {
    const resolved = real(name);
    if (resolved === workdir || resolved.startsWith(within)) refuse(`--${name} is inside --workdir, where the persona's own working tree would hold it.`);
  }
}

async function isFile(file) {
  for (let retry = 0; ; retry++) {
    try {
      return (await stat(file)).isFile();
    } catch (err) {
      if (err?.code === "ENOENT" || err?.code === "ENOTDIR") return false;
      if (!BUSY_CODES.has(err?.code) || retry >= BUSY_RETRIES) throw err;
      await new Promise((done) => setTimeout(done, BUSY_RETRY_MS));
    }
  }
}

if (nodeTooOld(process.version)) refuse(`node ${process.version} is older than ${NODE_FLOOR.join(".")}, the oldest this stand-in runs on.`);

// Imported once the floor check has passed: a static import of a name an old
// node's module lacks would fail at link time, before that check could run.
const { registerHooks } = await import("node:module");

const args = parseArgs(process.argv.slice(2));
refuseInsideWorkdir(args);
const storeFile = path.resolve(args["store-file"]);
let storeIsFile;
try {
  storeIsFile = await isFile(storeFile);
} catch (err) {
  refuse(`the store file ${storeFile} could not be read (${err?.code ?? "error"}).`);
}
if (!storeIsFile) refuse(`the store file ${storeFile} names no file on disk.`);

const pluginFolder = `${pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")).href}/`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && path.extname(specifier) === "" && context.parentURL?.startsWith(pluginFolder)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

try {
  await import("./adapters/scripted.ts");
  const { createHost } = await import("./host.ts");
  const bounds = boundsOf(args);
  await createHost({
    engine: args.engine,
    persona: args.persona,
    workdir: path.resolve(args.workdir),
    rundir: path.resolve(args.rundir),
    childDir: path.resolve(args["child-dir"]),
    storeFile,
    model: args.model,
    ...(args["options-file"] !== undefined ? { optionsFile: path.resolve(args["options-file"]) } : {}),
    ...(args.script !== undefined ? { script: path.resolve(args.script) } : {}),
    ...(bounds !== undefined ? { bounds } : {}),
  });
} catch (err) {
  refuse(`the host did not start: ${err instanceof Error ? err.message : String(err)}`);
}
