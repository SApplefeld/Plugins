# plugins

Four Claude Code plugins install from this one marketplace, `applefeld`. Each folder under `plugins/` holds one plugin's runtime files and nothing else. A publish job in each plugin's own repository replaces its folder in one commit, so an install follows those commits.

## Install

Add the marketplace once, then install the plugins you want:

```
claude plugin marketplace add SApplefeld/plugins
claude plugin install grimoire@applefeld
claude plugin install personas@applefeld
claude plugin install relay@applefeld
claude plugin install wiki@applefeld
```

A machine that already registered another marketplace named `applefeld` removes it first, since one machine cannot hold two marketplaces under one name.

## After Installing

Some plugins need a step past the install. Each step below runs from the plugin's installed folder, `<plugin cache>/applefeld/<plugin>/<sha>/`, where `<plugin cache>` is `~/.claude/plugins/cache`.

- **grimoire.** While `~/.claude/CLAUDE.md` lacks the kit's doctrine import, the kit's session hook offers to add it. The kit's doctor checks the machine, and on Windows it runs from the installed payload at `<plugin cache>/applefeld/grimoire/<sha>/doctor/doctor.cmd`, or as `/grimoire:kit-doctor` in any session. Add `-Fix` to apply its repairs.
- **personas.** The plugin runs in any session as installed. Its optional supervisor, `bin/supervise.sh`, runs from the installed folder.
- **relay.** The plugin is a shim that reaches a broker on the host. That broker needs a host install, from the install scripts in this repository's `plugins/relay/` folder, before a session can connect.
- **wiki.** The engine's setup script runs from its installed folder, per the walkthrough shipped beside it.

## Updating

`claude plugin marketplace update applefeld` reads the latest commit, and `claude plugin update <plugin>@applefeld` takes it. No plugin here carries a version number, so each publish is a new version.
