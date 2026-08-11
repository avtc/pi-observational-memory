import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerStatusCommand } from "./commands/status.js";
import { registerViewCommand } from "./commands/view.js";
import { registerCompactionHook } from "./hooks/compaction-hook.js";
import { registerCompactionTrigger } from "./hooks/compaction-trigger.js";
import { registerObserverTrigger } from "./hooks/observer-trigger.js";
import { Runtime } from "./runtime.js";
import { registerRecallTool } from "./tools/recall-observation.js";

/** API object exposed to host extensions via the `pi-observational-memory:ready` event.
 *  Lets a host reconfigure OM LIVE (clear the cached config + reload from settings.json/env)
 *  without `ctx.reload()` (which would invalidate the command ctx). */
export interface ObservationalMemoryReadyApi {
	/** Clear the cached config + reload from settings.json + env. Optional cwd
	 *  override; defaults to the live session cwd. */
	reloadConfig(cwd?: string): void;
	/** Read the current effective config (snapshot). */
	getConfig(): unknown;
}

export default function observationalMemory(pi: ExtensionAPI) {
	const runtime = new Runtime();

	registerObserverTrigger(pi, runtime);
	registerCompactionTrigger(pi, runtime);
	registerCompactionHook(pi, runtime);

	registerStatusCommand(pi, runtime);
	registerViewCommand(pi, runtime);
	registerRecallTool(pi);

	// The live session cwd — updated on session_start; reloadConfig uses it when no
	// explicit cwd override is passed.
	let currentCwd: string | undefined;

	const api: ObservationalMemoryReadyApi = {
		reloadConfig: (cwd?: string) => {
			runtime.reloadConfig(cwd ?? currentCwd ?? process.cwd());
		},
		getConfig: () => runtime.getConfig(),
	};

	// Defer :ready to session_start — ensures all consumers have registered their
	// pi.events.on listeners. Reload-safe: OM re-activates on each reload (pi.on
	// handlers are cleaned per-extension); consumers clean their own listener on
	// session_shutdown (see subscribe-to-observational-memory snippet).
	pi.on("session_start", (_event: unknown, ctx: ExtensionContext) => {
		currentCwd = ctx.cwd;
		pi.events.emit("pi-observational-memory:ready", api);
	});
}
