// The type contract .claude-plugin/plugin.json names under "types": the
// values this plugin holds in $.state, which the host keeps across a reload
// of the plugin's code and never persists. memqLaunchDir is the launch
// directory kitMemq runs memq from, written once by the first session.start
// that captures one. launchInstructions is the whole text of the latest
// [SUPERVISOR-PRIMING] prompt the supervisor wrote with the sdk origin,
// which session.compact repeats directly after a compaction's summary.
// compactionVerdicts is the compaction pass's verdict cache, one entry per
// tool result judged this session, by tool_use_id: the verdict the pass
// applies, the option Jev answered, and whether the stamp fell on the
// journal's holdout split, where the applied verdict is keep.
declare module "claude-code" {
  interface PluginState {
    "personas": {
      memqLaunchDir: string;
      launchInstructions: string;
      compactionVerdicts: Record<string, { verdict: "keep" | "cut" | "drop"; answered: string; holdout: boolean }>;
    };
  }
}
