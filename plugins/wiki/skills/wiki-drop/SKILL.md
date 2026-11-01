---
name: wiki-drop
description: Drops a document or a written text into a listed wiki's inbox through the engine's kb-drop.ps1, for the wiki's walker to ingest on its next pass. Use when asked to add, send, file or drop a document, notes or text into a wiki or knowledge base from a session outside it.
---

# wiki-drop

This is the procedure for adding a document to a wiki from a Claude Code
session in any folder. The engine is the wiki plugin's folder of scripts, the
plugin root that step 2 finds. The engine's `kb-drop.ps1` writes one file
under the wiki's `inbox/` folder and nowhere else. The walker is the
account's scheduled task that ingests each listed wiki's inbox into its
pages. Its next pass ingests the dropped file as it ingests any source.
Follow the steps in order.

## Who writes the wiki

The script is the only writer. Never create, edit or delete a file under a
wiki's folder yourself: not under `wiki/`, `sources/` or `inbox/`, and not
`index.md`, `log.md`, `CLAUDE.md` or anything else there. Never run git in a
wiki. The wiki's provenance and contradiction rules run in its ingest skill,
the skill that turns inbox files into pages inside that wiki. That skill runs
behind the wiki's permission wall, the wiki's own deny rules on raw git and
direct writes. A write from outside bypasses both.

Never edit the wiki list, `%LOCALAPPDATA%\llm-wiki\registry.json`, by hand.
`kb-registry.ps1` owns it.

## 1. What to drop

Take from the request:

- the target wiki's name;
- the document, as a path to an existing file, or the text to drop;
- an optional note on where the document came from.

Ask for whichever is missing.

Drop only a document the operator asked to drop, or a text this session wrote
for that purpose. Refuse to drop a file holding a credential, a key, a token,
a password or settings. Such files include `.env` files, `*.pem` and `*.key`
files, SSH keys, Claude Code settings and account files, and cloud
credential files. That list is illustrative, not complete. Refuse a text
holding a pasted token, key or password the same way.

Judge a file from its name and kind and from what the operator said of it.
Judge a text from its content, which this session already holds. Where you
are unsure, ask the operator rather than open a file to inspect it. The
walker ingests the inbox into pages and may push them to a git remote, so a
dropped secret leaves the machine.

## 2. Plugin root

Find the plugin root, the folder that holds `kb-drop.ps1`, in this order:

1. The `CLAUDE_PLUGIN_ROOT` environment variable, where the harness sets it.
2. The file `~/.claude/plugins/installed_plugins.json`. Its top-level
   `plugins` object holds a `wiki@applefeld` key whose value is a list of
   install records, each with a `scope` and an `installPath`. Take the first
   record whose `scope` is `user` and whose `installPath` folder holds
   `kb-drop.ps1`, else the first record whose folder holds it.

Use the first that holds `kb-drop.ps1`. If none does, stop and tell the
operator the engine was not found. The same folder holds `kb-registry.ps1`.

## 3. Target confirmation

Run:

    pwsh -NoProfile -File '<plugin root>\kb-registry.ps1' List

Exit 0 prints one line per wiki with four tab-separated columns: the name,
the folder, the engine mark and the description. The engine mark is the
first eight characters of the `templateHash` in the wiki's
`.claude/engine.json`, or `unknown` where that file is absent or does not
hold a 64-character hexadecimal `templateHash`. The target is the line whose
first column equals the operator's name for the wiki, ignoring case. Use that
column's spelling as `<wiki>` below.

Where no line matches, stop. Show the operator the list as the script printed
it and ask which wiki they meant. Never pick the nearest name. Where the
script printed no line, the account has no wikis: say so and name the
`wiki-new` skill of this same plugin as the way to create one. Exit 1 prints
one line, `kb-registry: <reason>`, on stderr: relay it as it stands and end
the procedure. Any other outcome: relay the stderr lines as they stand and
end the procedure.

## 4. Drop call

For a file, run:

    pwsh -NoProfile -File '<plugin root>\kb-drop.ps1' -Wiki '<wiki>' -File '<path>'

Give `<path>` as an absolute Windows path, such as `C:\notes\call.md`, never
in the `/c/...` form a bash tool uses. The script copies the file byte for byte
under its own file name. It takes no `-Name`, `-DroppedBy` or `-Note` with
`-File`, so a note the operator gave for a file is not recorded. Tell them
so.

For a text, run:

    pwsh -NoProfile -File '<plugin root>\kb-drop.ps1' -Wiki '<wiki>' -Content '<text>' -Name '<file>' -DroppedBy '<working directory>' [-Note '<note>']

`<file>` is the name the text is written under in the inbox, such as
`call-notes.md`. Take it from the operator, or make a short lowercase name
with hyphens from the text's subject. `<working directory>` is this
session's working directory, as an absolute Windows path. Pass `-Note` only
where the operator gave one. The script writes a front-matter block above the
text, recording the time, `<working directory>` and the note. The ingest reads
the block with the text. Never write a block of that shape into the text
yourself, since no ingest rule tells a hand-made one from the script's.

The script checks the name and refuses one it does not accept, so do not
check the name rules yourself.

Quote every value, the script path included, as a single-quoted literal.
Never build the call in a double-quoted string, where `$` and the backtick
expand. Write a single-quote character inside a quoted value by the shell's
rule:

- PowerShell 7: double every single-quote character in the value, meaning the
  ASCII apostrophe and the curly quotes U+2018, U+2019, U+201A and U+201B,
  each doubled as itself. PowerShell reads all five as quote marks, so one
  left undoubled closes the literal and the rest of the value runs as a
  command. So `C:\Users\O'Neil` is written `'C:\Users\O''Neil'`.
- bash: only the ASCII apostrophe is a quote mark. For each one, close the
  quote, add a backslash and an apostrophe, and reopen the quote. So
  `C:\Users\O'Neil` is written `'C:\Users\O'\''Neil'`.

A value that starts with a hyphen or a dash can be read by the child
PowerShell as a parameter name, and the call then fails. The dashes that
count are the en dash, the em dash and the horizontal bar. Write every such
value in the colon form, with no space after the colon: `-Note:'-y'`, or
`-Content:'- first item'` for a text that opens on a list.

Never run the call from Windows PowerShell 5.1. It passes an embedded double
quote to the child unescaped, and so do PowerShell 7.0 to 7.2. In a
PowerShell tool, read `$PSVersionTable.PSVersion` first. Below 7.3, use a bash
tool instead.

From a bash tool, set `MSYS_NO_PATHCONV=1` on the command, as in:

    MSYS_NO_PATHCONV=1 pwsh -NoProfile -File '<plugin root>\kb-drop.ps1' -Wiki '<wiki>' -File '<path>'

Without it, Git Bash rewrites a value that starts with `/` into a Windows
path before the script sees it. The 7.3 rule binds the calling PowerShell,
which builds the child's command line, and from bash, bash builds it. Run
`pwsh --version` first all the same: the script needs PowerShell 7.0 or
later. Below 7.0, stop and tell the operator.

A Windows command line holds about 32,000 characters. A text longer than that
fails to start. Tell the operator rather than splitting the text or writing it
anywhere yourself.

## 5. Result

- Exit 0: the script prints the written file's full path. Print it, then the
  line: the walker ingests this file on its next pass.
- Exit 1: the script prints one line, `kb-drop: <reason>`, on stderr. A
  refusal, such as for a name already in the inbox or a wiki that is not
  listed, writes nothing. A write that failed partway names the failure and
  can leave a partial file in the inbox, which the operator removes. Relay the
  line to the operator unchanged and end the procedure. Never retry under a
  changed name without the operator's word.
- Any other outcome: relay the stderr lines as they stand and end the
  procedure.
