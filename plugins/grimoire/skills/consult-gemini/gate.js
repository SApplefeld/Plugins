// agy PreToolUse hook for consult.sh: allows only read-only tools, and only on paths inside the work folder.
// agy runs it with the working directory set to <work>/.agents, so the work folder is the parent.
const path = require('path');

const READ_ONLY = new Set(['view_file', 'read_file', 'list_dir', 'grep_search', 'find_by_name', 'finish', 'wait', 'wait_5_seconds']);
const work = path.resolve(process.cwd(), '..').toLowerCase();

// A trimmed string is refused outright rather than resolved where it holds a control character or a variable form,
// or where it opens with a URI scheme (a letter and one or more scheme characters before a colon, so a drive letter
// is not one). A scheme later in the string is not refused here; the string is then resolved like any other.
const REFUSED = [/[\x00-\x1f\x7f]/, /^[a-z][a-z0-9+.-]+:/i, /%[^%]*%/, /\$[A-Za-z_{]/];

function reply(decision, reason) {
	process.stdout.write(JSON.stringify({ decision, reason }));
}

function isPlainObject(value) {
	return Object.prototype.toString.call(value) === '[object Object]';
}

// A real tool call nests a few levels deep, so arguments nested past this many levels are refused unread.
const MAX_DEPTH = 64;

// Every string at any depth, an object's keys among them, must resolve inside the work folder, whatever it
// looks like, so a query or a pattern that does not resolve there is refused too: the gate fails closed.
// A string that parses as a JSON object or array is walked as the arguments are, one level deeper.
function outsidePaths(value, found = [], depth = 0) {
	if (depth > MAX_DEPTH) throw new Error('tool arguments nested past ' + MAX_DEPTH + ' levels');
	if (typeof value === 'string') {
		const text = value.trim();
		if (/^[[{]/.test(text)) {
			let parsed;
			try { parsed = JSON.parse(text); } catch { parsed = null; }
			if (parsed && typeof parsed === 'object') return outsidePaths(parsed, found, depth + 1);
		}
		if (REFUSED.some(shape => shape.test(text))) {
			found.push(value);
			return found;
		}
		// A leading ~ is read as the user's profile folder, and with no profile folder to read it as, the string is refused.
		if (text.startsWith('~') && !process.env.USERPROFILE) {
			found.push(value);
			return found;
		}
		const resolved = path.resolve(work, text.replace(/^~/, process.env.USERPROFILE)).toLowerCase();
		if (resolved !== work && !resolved.startsWith(work + path.sep)) found.push(value);
	} else if (value && typeof value === 'object') {
		for (const [k, v] of Object.entries(value)) {
			outsidePaths(k, found, depth + 1);
			outsidePaths(v, found, depth + 1);
		}
	}
	return found;
}

function decide(input) {
	let call;
	try { call = JSON.parse(input).toolCall; } catch { return reply('deny', 'consult gate could not read the tool call'); }
	if (!call || !READ_ONLY.has(call.name)) {
		return reply('deny', 'This consultation is read-only: ' + (call ? call.name : 'unknown tool') + ' is not allowed. Answer from the question and attached files.');
	}
	if (call.args !== undefined && !isPlainObject(call.args)) {
		return reply('deny', 'consult gate refused tool arguments that are not an object');
	}
	const outside = outsidePaths(call.args);
	if (outside.length) {
		return reply('deny', 'This consultation may only read the attached files. Outside path refused: ' + outside[0]);
	}
	reply('allow', 'read-only tool inside the work folder');
}

// Any error while deciding, a walk past MAX_DEPTH among them, is a deny, so every call gets a decision.
let input = '';
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
	try { decide(input); } catch (err) { reply('deny', 'consult gate could not check the tool call: ' + err.message); }
});
