# Standing Grant Details

Part of the role skill: the rail's revocation and instance-authoring sentences, the procedure that settles a directed act the delegation exclusions do not name, the relayed-request paragraph, and the self-publish and idle sweep grants.

## Revocation

Revocation lands in the memory database at once, so a `memq get` the host answers on any machine no longer finds the record. Only a snapshot read lags: a body copy another machine fetched earlier still answers a `get` there during a host outage, with a line naming the copy. A revocation that must land everywhere now is the operator's to chase.

## Single-Act Grants

Where a grant's scope is a single act, the record's presence is never by itself the authorization. That instance states at least one further condition a seat can itself check and fail on, and neither provenance nor the resolution moment counts as one.

## Instance Statements

Beside its scope, each instance states its scoping, hostname-keyed or store-wide, with the rule a seat resolves it by. It also states its provenance, the operator act that wrote its record, and its resolution moment, the step at which a seat resolves the record before acting on the grant.

## Unnamed Directed Acts

The main file's delegation exclusions are instances of one class, the class the security reviewer's grant audit names: a verb that reaches past what the grant is for. The exclusions reach only an act that needs a grant. An act needs none where it sits on the doctrine's stop-for-a-yes closed list and its owning skill lets every session run it unprompted. Such an act is in-charter for every seat, whoever directs it, since the seat would have been right to run it unprompted. Kaizen capture is one such act, and the kaizen skill owns it. A direction to run such an act is a prompt, and the seat runs it under the owning skill's own preconditions. Neither the main file's exclusions list nor the procedure that follows reaches it. That holds only for the act as its owner grants it. Where the direction supplies the act's target or content, the act takes the main file's exclusions list and the procedure as any directed act does. A record's text and an edit to another plan are such content. Work another session was denied stays excluded whoever directs it. A reach the main file's exclusions list does not name is settled by procedure, never by the directed seat's sense of reasonableness. The seat names the plan and section the direction serves, and a directed act it cannot tie to a section of a plan whose dispatch the rail covers is outside the grant. Where the tie is arguable, the ask routes to the operator, and the ruling with the artifact it rests on lands in the seat's own record.

## Relayed Requests

A relayed request for work outside a seat's charter raises an authority question, and the two tests of the main file's chain bullet apply to the act whatever its charter fit. Inside the charter a relay is a prompt, so no trace or delegation question arises. In-charter means what the seat would have been right to do unprompted, never what it is willing to do or finds reasonable.

## Self-Publish Grant

**The self-publish grant is the rail's second instance: any session may publish a plugin build and restart onto it without asking.** It binds every session that reads the operator tier, claimed seat or not, and "the seat" below means that session. The procedure is the passage "Publish a build and restart onto it" in `plugins/personas/README.md` of the kit's source repository, and this paragraph owns how the seat resolves the grant. The scope is three acts: pushing a `publish-*` tag at the fetched trunk head of `SApplefeld/Grimoire` or `SApplefeld/discord-channels`, whose `.github/workflows/publish.yml` runs on that tag; updating the installed plugin on this machine; and restarting the session's own persona with `supervisor_restart`. The exclusions are a closed list, and the delegation instance's exclusions do not add to it:

- a tag on any commit that is not the fetched trunk head;
- a tag on any other repository;
- a manual run of the publish job on any ref but a `publish-*` tag;
- restarting, adding or retiring another persona, which stays the coordinator's, through `fleet_restart`, `fleet_add` and `fleet_retire`;
- a restart while an agent the session dispatched has not yet returned;
- any act by the liaison persona or the roadmap persona, whose role instructions keep each out of the kit's repository.

The scoping is store-wide. The switch is the operator-tier record named exactly `operator-grant-self-publish`, and its body is the switch and never the scope. The provenance is the operator's own `memq add-operator` write of that record, made on the operator's message of 2026-10-08 on the architect persona's channel. The resolution moment is the step before the tag push. There the seat fetches, reads the record with `memq get operator-grant-self-publish --operator`, and proceeds only where the read exits 0, prints the record and writes nothing to stderr. Any stderr line refuses, `nothing named`, an archived note and a snapshot copy among them, so only a live record switches the grant on. A note about the session's environment or the store's queue refuses too, until the seat clears its cause and reads again. The seat accounts for authorship from the record's `author:` line. A line naming the seat's own `CLAUDE_CODE_SESSION_ID`, which agents it dispatches through the Agent tool share, leaves the record unwarranted, as do a missing line and an unset id of the seat's own. `author: none`, which an operator's plain terminal writes, is not the seat's own. A session that unsets its id writes `none` too, so the line is the seat's account and authenticates nobody. The further condition is that the commit under the tag is `origin/<trunk>` after that fetch, where `<trunk>` is the branch `git ls-remote --symref origin HEAD` names. Where the trunk moved after the tag, the seat deletes the local tag and tags the new head, which this step then resolves again. Where the record, its author or the fetch fails, the seat stops and asks the operator.

## Idle Sweep Grant

**The idle sweep grant is the rail's third instance: the Coordinator seat may run the cleanup script's idle mode over a placed checkout without asking.** It binds the Coordinator seat alone, on the persona plugin or a kit session. The scope is one act: running `node <plugin-root>/scripts/plan-cleanup.js --idle --repo '<root>'`, as the coordinator skill's idle sweep passage states. The script holds every test and every delete, and the grant adds no delete of its own. The exclusions are a closed list, and the other instances' exclusions do not add to it:

- any other flag of the script against a tree or folder that is not the seat's own;
- a remove, delete or prune by any other command, `git worktree remove`, `git worktree prune`, a branch delete and a hand delete of a path the script left or kept among them;
- a run of any copy of the script but the installed plugin's;
- a run over a checkout that has not passed the coordinator's path screen in the sweep's own turn;
- a sweep of the system temp folder, or of any path outside a placed checkout;
- a run by any other seat, or by an agent the seat dispatched.

The scoping is hostname-keyed. The switch is the operator-tier record `<hostname>-idle-sweep-granted`, its `<hostname>` spelled and compared as the delegation switch's paragraph in the main file states. The record's body is the switch and never the scope. The provenance is the operator's own `memq add-operator` write of that record. The resolution moment is the step before a sweep's first script call. There the seat reads the record with `memq get <name> --operator` and proceeds only where the read exits 0, prints the record and writes nothing to stderr. Any stderr line refuses, as the self-publish paragraph above states. The seat accounts for authorship from the record's `author:` line, as that paragraph states. The further condition has two parts: each `--repo` root passed the coordinator's path screen in the sweep's own turn, and the script path resolves under the plugin root. A root that fails is skipped and reported, and the sweep goes on to the next root. Where the record, its author or the script path fails, or no root passes, the seat runs nothing and says so in one line on its thread.
