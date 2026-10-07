#!/usr/bin/env node
// kit-statusline launcher: the path an operator's status-line setting may
// still name. Doctor -Fix copies this file to ~/.claude/bin/kit-statusline.js
// beside memq-shim.js, and a status-line tool runs it by that path:
//
//   node "%USERPROFILE%\.claude\bin\kit-statusline.js"
//
// The kit ships no status-line widget, so this prints one empty line and exits
// 0 whatever it is given: a setting that names it draws an empty segment and
// never an error. The doctor warns where Claude Code's statusLine setting
// names this file, since that setting can go.

'use strict';

// The status-line JSON is drained and never read: a host that writes it to a
// child that exited first meets a closed pipe. No stdin at all is the same
// answer.
try { require('fs').readFileSync(0); } catch { /* no stdin, or one that would not read */ }

// Where stdout is a synchronous pipe (Windows and Linux) a closed pipe throws
// EPIPE at the write; on macOS it surfaces as an 'error' event instead, which
// no try can see. Either way a closed status-line pipe is silence, not a crash.
process.stdout.on('error', () => { /* see above */ });
try { process.stdout.write('\n'); } catch { /* see above */ }
