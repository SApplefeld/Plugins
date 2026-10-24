// The plugin release reader: when the harness last updated the relay plugin, taken from the
// harness's own install record and from nothing else.
//
// The record is `installed_plugins.json` under the account's `.claude/plugins` directory. It belongs
// to another program and sits beside the harness's credentials, so this module takes exactly two
// fields of one entry by allowlist, `gitCommitSha` and `lastUpdated`, and never re-serializes any
// part of the file. The read is byte-capped, and a file that is missing, oversized, malformed or the
// wrong shape yields the pass's one unreadable sentinel rather than a throw. Nothing read here is
// logged: a parse error embeds an excerpt of its own source, so it is discarded unread.
import { readSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readCappedFile } from "../capped-read.ts";
import type { CappedReader } from "../capped-read.ts";
import { UNREADABLE } from "./pass.ts";

/**
 * Ceiling on the install record. The live record runs a few kilobytes for a dozen plugins, so this is
 * room for dozens of times that before a file this reader will not read.
 */
export const MAX_INSTALLED_PLUGINS_BYTES = 256 * 1024;

/** The plugin whose entry is read: the one this repository ships, which the kit loads with it. */
const RELEASE_PLUGIN = "relay";

/** The scope of the entry preferred where the record holds several for the plugin. */
const PREFERRED_SCOPE = "user";

/** A commit id in full: 40 hex digits, which a build number or a short id does not meet. */
const COMMIT_SHA = /^[0-9a-f]{40}$/i;

/** An instant that names its offset, since `Date.parse` reads a bare date and time in local time. */
const EXPLICIT_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/** Where the harness keeps its install record: `.claude/plugins` under the account the broker runs as. */
export function installedPluginsPath(home: string = os.homedir()): string {
  return path.join(home, ".claude", "plugins", "installed_plugins.json");
}

/** The relay plugin's release: its commit and the instant the harness last updated it, in epoch milliseconds. */
export type InstalledRelease = { sha: string; updatedAt: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The plugin half of a `<plugin>@<marketplace>` key, split at the last `@`; null for a key with none. */
function pluginOf(key: string): string | null {
  const at = key.lastIndexOf("@");
  return at < 0 ? null : key.slice(0, at);
}

/** The entry read: scope `user` where one exists, else the first in record order. */
function chosenEntry(plugins: Record<string, unknown>): Record<string, unknown> | null {
  const entries: Record<string, unknown>[] = [];
  for (const [key, held] of Object.entries(plugins)) {
    if (pluginOf(key) !== RELEASE_PLUGIN || !Array.isArray(held)) continue;
    for (const entry of held) if (isRecord(entry)) entries.push(entry);
  }
  return entries.find((entry) => entry["scope"] === PREFERRED_SCOPE) ?? entries[0] ?? null;
}

/**
 * The relay plugin's release from the install record at `file`, or `UNREADABLE`.
 *
 * Only the chosen entry is judged: where it lacks a full commit id or an instant that parses with an
 * explicit offset, the record reads as unreadable and no other entry stands in for it. A leading
 * byte-order mark is stripped before the parse, since neither the capped read nor the usage cache
 * reader strips one.
 * `read` is the capped read's injected reader. It does not throw, whatever the file holds.
 */
export function readInstalledPlugins(
  file: string,
  read: CappedReader = readSync,
): InstalledRelease | typeof UNREADABLE {
  try {
    const capped = readCappedFile(file, MAX_INSTALLED_PLUGINS_BYTES, read);
    if ("failed" in capped) return UNREADABLE;
    const record: unknown = JSON.parse(capped.text.replace(/^\uFEFF/, ""));
    if (!isRecord(record) || !isRecord(record["plugins"])) return UNREADABLE;
    const entry = chosenEntry(record["plugins"]);
    if (entry === null) return UNREADABLE;
    const sha = entry["gitCommitSha"];
    const updated = entry["lastUpdated"];
    if (typeof sha !== "string" || !COMMIT_SHA.test(sha)) return UNREADABLE;
    if (typeof updated !== "string" || !EXPLICIT_OFFSET.test(updated)) return UNREADABLE;
    const updatedAt = Date.parse(updated);
    return Number.isFinite(updatedAt) ? { sha, updatedAt } : UNREADABLE;
  } catch {
    return UNREADABLE;
  }
}
