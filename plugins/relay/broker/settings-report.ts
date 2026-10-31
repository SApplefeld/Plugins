// What a host's broker.env leaves unset, what it sets that the next host copies, what it sets that
// the next host sets for itself, and what it holds that the broker does not know. Run as
// `node broker/settings-report.ts <path to broker.env>` by the repair pass, which prints the output on
// the operator's own console.
//
// It reads only the file it is given. The file is read the way `Get-ChannelEnvFile` in
// `install/Install-Functions.ps1` reads it, so a key listed as set here is one the launcher applies:
// a blank line and a line whose first non-space character is `#` are skipped, a line splits on its
// first `=`, the key is trimmed, a line with no `=` is dropped, and a later line for a key replaces
// an earlier one. PowerShell compares keys without regard to case, so this does too. A key counts as
// set when its value is not blank, since the broker trims each value and takes a blank as unset.
//
// It reads the file and never the scheduled task's environment. A bot token the task's account
// carries in its environment therefore does not count here. An unset entry that such a key can stand
// in for is listed with a note naming that key, so the list still matches the broker's start-up line
// on a host that sets one.
// Only an ASCII value is sure to print as the launcher applies it. Windows PowerShell 5.1 reads a
// broker.env with no byte-order mark in the system's ANSI code page, this module reads UTF-8, and the
// console decodes node's output in its own encoding.
import { readFileSync } from "node:fs";
import { SETTINGS, SUPPLIED_BY, unsetGatingKeys } from "./settings.ts";

const HEADINGS = {
  unset: "Unset, so a feature is off:",
  fleet: "Set here, copy to the next host:",
  host: "Set here, the next host sets its own:",
  unknown: "In the file, unknown to the broker:",
};

type Entry = { name: string; value: string };

// The shape of an environment variable's name. A name with another shape, holding a space or
// punctuation, may be a pasted secret, so the report counts such names and never shows them. A secret
// that happens to have this shape, such as base64 text with no "+" or "/", is still shown by name.
const KEY_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The file's keys by upper-cased name, each holding the first spelling seen and the last value. */
function readEnvFile(text: string): Map<string, Entry> {
  const entries = new Map<string, Entry>();
  for (const line of text.replace(/^﻿/, "").split(/\r\n|\n|\r/)) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const at = line.indexOf("=");
    if (at === -1) continue;
    const name = line.slice(0, at).trim();
    const value = line.slice(at + 1);
    const folded = name.toUpperCase();
    entries.set(folded, { name: entries.get(folded)?.name ?? name, value });
  }
  return entries;
}

function section(heading: string, items: readonly string[]): string[] {
  return [heading, ...(items.length === 0 ? ["  none"] : items.map((item) => `  ${item}`))];
}

/** The unknown keys by name, then one line counting the names that are not key names, unshown. */
function unknownItems(entries: Map<string, Entry>, catalogued: ReadonlySet<string>): string[] {
  const names = [...entries].filter(([folded]) => !catalogued.has(folded)).map(([, entry]) => entry.name);
  const shown = names.filter((name) => KEY_NAME.test(name));
  const hidden = names.length - shown.length;
  if (hidden === 0) return shown;
  return [...shown, hidden === 1 ? "1 name that is not a key name, not shown" : `${hidden} names that are not key names, not shown`];
}

function report(text: string): string {
  const entries = readEnvFile(text);
  const catalogued = new Set(SETTINGS.map((setting) => setting.key));
  // Catalogued keys only: the launcher refuses any other key, a direct bot token among them, so a key
  // outside the catalog supplies nothing on this host.
  const values: Record<string, string> = {};
  for (const [folded, entry] of entries) if (catalogued.has(folded)) values[folded] = entry.value;

  const setHere = SETTINGS.filter((setting) => (values[setting.key] ?? "").trim() !== "");
  const lines = [
    ...section(
      HEADINGS.unset,
      unsetGatingKeys(values).map((key) =>
        SUPPLIED_BY[key] === undefined ? key : `${key} (unless ${SUPPLIED_BY[key].join(" or ")} is set in the broker's environment)`,
      ),
    ),
    "",
    ...section(
      HEADINGS.fleet,
      setHere.filter((setting) => setting.scope === "fleet").map((setting) => `${setting.key}=${values[setting.key].trim()}`),
    ),
    "",
    ...section(
      HEADINGS.host,
      setHere.filter((setting) => setting.scope === "host").map((setting) => `${setting.key}=${values[setting.key].trim()}`),
    ),
    "",
    // Names only: a key the broker does not know may hold a credential, and this prints to a screen.
    ...section(HEADINGS.unknown, unknownItems(entries, catalogued)),
  ];
  return lines.join("\n");
}

const file = process.argv[2];
if (file === undefined || process.argv.length !== 3) {
  console.error("settings-report: expected one argument, the path to a broker.env");
  process.exit(2);
}
let text: string;
try {
  text = readFileSync(file, "utf8");
} catch (error) {
  const code = (error as NodeJS.ErrnoException).code ?? "unreadable";
  console.error(`settings-report: cannot read ${file} (${code})`);
  process.exit(1);
}
console.log(report(text));
