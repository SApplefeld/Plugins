// run.mjs: the persona tools server an engine starts, as a line copier.
//
//   PERSONAS_PIPE_TOKEN=<token> node run.mjs --connect <pipe name>
//
// It connects to the pipe the host listens on, writes the token from its
// environment as the connection's first line, then copies its stdin to the
// pipe and the pipe to its stdout until either side closes. It builds and
// holds nothing: the host answers every line.
//
// It refuses any argument but --connect with one value, and a missing or
// empty token, each with exit code 2 and one sentence on stderr, writing
// nothing to stdout. A connection that fails ends with exit code 1. So does
// a close from the host that comes before any reply byte reached stdout
// while stdin is still open, with one sentence on stderr: the host refused
// the token or closed the connection before answering. A close from the host
// after a reply ends with exit code 0, as does a close that follows the end
// of stdin. The token is never an argument, so no process listing
// shows it.

import net from "node:net";

function refuse(sentence) {
  process.stderr.write(`persona tools server: ${sentence}\n`);
  process.exit(2);
}

const argv = process.argv.slice(2);
if (argv.length !== 2 || argv[0] !== "--connect" || argv[1] === "") {
  refuse("it takes --connect <pipe name> and nothing else.");
}
const token = process.env.PERSONAS_PIPE_TOKEN;
if (token === undefined || token === "") refuse("PERSONAS_PIPE_TOKEN is not set.");

// Whether a reply byte has come from the host, and whether stdin has ended.
let answered = false;
let inputEnded = false;

// The socket holds what is written before it connects, so the token goes
// first and stdin's lines follow it in order.
const socket = net.connect(argv[1]);
socket.write(`${token}\n`);
process.stdin.on("end", () => { inputEnded = true; });
process.stdin.pipe(socket);
socket.on("data", () => { answered = true; });
socket.pipe(process.stdout);
socket.on("error", (err) => {
  process.stderr.write(`persona tools server: the pipe failed (${err.code ?? "error"}).\n`);
  process.exitCode = 1;
});
// The host closed its side: stop reading stdin so the process can exit once
// stdout has drained.
socket.on("close", () => {
  if (!answered && !inputEnded && process.exitCode !== 1) {
    process.stderr.write("persona tools server: the host closed the pipe before it answered, so the token was refused or the connection was closed.\n");
    process.exitCode = 1;
  }
  process.stdin.unpipe(socket);
  process.stdin.destroy();
});
