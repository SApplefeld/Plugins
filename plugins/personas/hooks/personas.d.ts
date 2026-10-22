// The type contract .claude-plugin/plugin.json names under "types": the
// values this plugin holds in $.state, which the host keeps across a reload
// of the plugin's code and never persists. memqLaunchDir is the launch
// directory, written once by the first session.start whose $.state read
// answers:
// kitMemq runs memq from it, and the persona store, the yield log and the
// goal history resolve against it, so they stay put when a reload's start
// sees a moved cwd. launchInstructions is the whole text of the latest
// [SUPERVISOR-PRIMING] prompt the supervisor wrote with the sdk origin,
// which session.compact repeats directly after a compaction's summary.
// compactionVerdicts is the compaction pass's verdict cache, one entry per
// tool result judged this session, by tool_use_id: the verdict the pass
// applies, the option Jev answered, and whether the stamp fell on the
// journal's holdout split, where the applied verdict is keep.
// recognitionNudgeMarker is the memory-recognition nudge's dedup marker:
// the keys of the records it pointed at this session, tool and prompt keys
// in `fired` and a started subagent's in `firedDispatch`, and the start and
// spend of the tool window and the prompt window its caps count in.
declare module "claude-code" {
  interface PluginState {
    "personas": {
      memqLaunchDir: string;
      launchInstructions: string;
      compactionVerdicts: Record<string, { verdict: "keep" | "cut" | "drop"; answered: string; holdout: boolean }>;
      recognitionNudgeMarker: { fired: Record<string, 1>; firedDispatch: Record<string, 1>; windowStart: number; windowCount: number; promptStart: number; promptCount: number };
    };
  }
}
