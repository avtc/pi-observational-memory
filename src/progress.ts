import type { AgentEvent } from "@earendil-works/pi-agent-core";
import { estimateStringTokens, formatTokens } from "./tokens.js";

export type CompactionPhase = "observer" | "reflector" | "pruner";

export interface ThemeLike {
	fg: (color: string, text: string) => string;
}

const ALL_PHASES: CompactionPhase[] = ["observer", "reflector", "pruner"];

// A usage slice as it appears on a message/message_update message (all fields
// optional — providers report varying subsets; missing → absent).
interface MessageUsageLike {
	totalTokens?: number;
	output?: number;
}

/** Read cumulative usage off a `message_end` message (undefined when absent). */
function messageUsage(event: AgentEvent & { type: "message_end" }): MessageUsageLike | undefined {
	return (event.message as { usage?: MessageUsageLike } | undefined)?.usage;
}

/** Read the streamed cumulative output-token count off a `message_update` when
 *  the provider reports usage mid-stream (primary tier). Null when not present. */
function streamedOutputUsage(event: AgentEvent & { type: "message_update" }): number | null {
	const output = (event.message as { usage?: MessageUsageLike } | undefined)?.usage?.output;
	return typeof output === "number" ? output : null;
}

/** Extract the delta string from a streamed assistant-message event (fallback
 *  tier — chars/4 over text/thinking/toolcall deltas). Null otherwise. */
function deltaTextOf(event: AgentEvent & { type: "message_update" }): string | null {
	const inner = (event as { assistantMessageEvent?: { type?: string; delta?: string } }).assistantMessageEvent;
	if (inner?.type === "text_delta" || inner?.type === "thinking_delta" || inner?.type === "toolcall_delta") {
		return inner.delta ?? null;
	}
	return null;
}

export class CompactionProgressTracker {
	private phase: CompactionPhase | undefined;
	private pass = 0;
	private maxPasses = 0;
	private toolCallCount = 0;
	private turnCount = 0;
	// Starting counts before compaction tools run
	private startingReflections = 0;
	private startingObservations = 0;
	// Accumulated deltas across all passes within a phase
	private reflectionsAdded = 0;
	private reflectionsMerged = 0;
	private observationsDropped = 0;
	private completedPhases: CompactionPhase[] = [];
	// Streaming token progress (two-tier, per current generation):
	// primary = running max of mid-stream message_update usage.output (providers
	// that stream usage); fallback = chars/4 over text/thinking/toolcall deltas
	// so the counter always moves. Displayed value = max of the two.
	private primaryTokens = 0;
	private fallbackTokens = 0;
	private streamingOutputTokens = 0;
	// The compaction agent's context-window consumption (its last message_end
	// usage.totalTokens) — the per-agent ctx-usage figure the widget surfaces
	// (NOT the main session's usage). Null until the first message_end of the phase.
	private agentContextTokens: number | null = null;
	// The compaction model's context window (denominator), set once per compaction.
	private contextWindow: number | null = null;

	getPhase(): CompactionPhase | undefined {
		return this.phase;
	}

	getPass(): number {
		return this.pass;
	}

	getMaxPasses(): number {
		return this.maxPasses;
	}

	getToolCallCount(): number {
		return this.toolCallCount;
	}

	getTurnCount(): number {
		return this.turnCount;
	}

	getContextTokens(): number | null {
		return this.agentContextTokens;
	}

	getContextWindow(): number | null {
		return this.contextWindow;
	}

	getStreamingOutputTokens(): number {
		return this.streamingOutputTokens;
	}

	/** Set the compaction model's context window (the ctx-usage denominator). */
	setContextWindow(window: number | null): void {
		this.contextWindow = window;
	}

	setPhase(phase: CompactionPhase, pass: number, maxPasses: number): void {
		const prevPhase = this.phase;
		if (prevPhase && prevPhase !== phase && !this.completedPhases.includes(prevPhase)) {
			this.completedPhases.push(prevPhase);
		}
		// Reset deltas when transitioning to a different phase
		if (prevPhase !== phase) {
			this.reflectionsAdded = 0;
			this.reflectionsMerged = 0;
			this.observationsDropped = 0;
		}
		this.phase = phase;
		this.pass = pass;
		this.maxPasses = maxPasses;
		// Reset per-phase counters only when transitioning to a different phase,
		// not when advancing pass/batch within the same phase
		if (prevPhase !== phase) {
			this.toolCallCount = 0;
			this.turnCount = 0;
			// A new phase is a new agent run: drop the previous phase's ctx usage
			// (shows "?" until its first message_end) and stale streaming counters.
			// The context window (a model property) survives — same model throughout.
			this.agentContextTokens = null;
			this.primaryTokens = 0;
			this.fallbackTokens = 0;
			this.streamingOutputTokens = 0;
		}
	}

	setStartingCounts(reflections: number, observations: number): void {
		this.startingReflections = reflections;
		this.startingObservations = observations;
	}

	setCompletedPhases(phases: CompactionPhase[]): void {
		this.completedPhases = phases;
	}

	onEvent(event: AgentEvent): void {
		if (!this.phase) return;
		switch (event.type) {
			case "tool_execution_start":
				this.toolCallCount++;
				break;
			case "tool_execution_end": {
				if (event.isError) break;
				const details = (event.result as { details?: Record<string, unknown> } | undefined)?.details;
				if (!details) break;
				if (event.toolName === "record_reflections") {
					this.reflectionsAdded += (details.added as number) ?? 0;
					this.reflectionsMerged += (details.merged as number) ?? 0;
				} else if (event.toolName === "drop_observations") {
					this.observationsDropped += Array.isArray(details.dropped) ? details.dropped.length : 0;
				}
				break;
			}
			case "turn_start":
				this.turnCount++;
				break;
			case "message_start":
				// Each assistant message is a new generation (an observer chunk, a
				// reflector/pruner turn). Reset the streaming counter so it reflects the
				// CURRENT generation (ticks up from 0), not a phase-wide cumulative whose
				// per-generation additions become invisible.
				this.primaryTokens = 0;
				this.fallbackTokens = 0;
				this.streamingOutputTokens = 0;
				break;
			case "message_update": {
				// primary tier (provider streams usage): guard > tokensSoFar so a smaller
				// per-message value (usage.output resets each message) never moves it back.
				const streamed = streamedOutputUsage(event);
				if (streamed !== null && streamed > this.primaryTokens) {
					this.primaryTokens = streamed;
				}
				// fallback tier (chars/4 over text + thinking + tool-call deltas):
				// accumulates so the counter always moves, including during extended
				// thinking when the provider typically does NOT stream usage.output.
				const delta = deltaTextOf(event);
				if (delta !== null) {
					this.fallbackTokens += estimateStringTokens(delta);
				}
				// max — NOT primary-wins: a provider that reports usage.output once early
				// then goes silent during thinking would otherwise freeze the counter at
				// that stale value while the fallback (thinking deltas) rises unseen. max
				// shows whichever is further along, so the counter progresses throughout
				// streaming and converges to accurate output when the provider reports it.
				this.streamingOutputTokens = Math.max(this.primaryTokens, this.fallbackTokens);
				break;
			}
			case "message_end": {
				// the agent's context-window consumption for this message (the per-agent
				// ctx-usage figure the widget surfaces — NOT the main session's).
				const usage = messageUsage(event);
				if (usage !== undefined && typeof usage.totalTokens === "number") {
					this.agentContextTokens = usage.totalTokens;
				}
				break;
			}
		}
	}

	clear(): void {
		this.phase = undefined;
		this.pass = 0;
		this.maxPasses = 0;
		this.toolCallCount = 0;
		this.turnCount = 0;
		this.startingReflections = 0;
		this.startingObservations = 0;
		this.reflectionsAdded = 0;
		this.reflectionsMerged = 0;
		this.observationsDropped = 0;
		this.completedPhases = [];
		this.primaryTokens = 0;
		this.fallbackTokens = 0;
		this.streamingOutputTokens = 0;
		this.agentContextTokens = null;
		this.contextWindow = null;
	}

	formatWidget(theme: ThemeLike): string {
		if (!this.phase) return "";

		const parts: string[] = [];

		// Pipeline overview: show all phases with completion state
		const phaseLabels = ALL_PHASES.map((p) => {
			if (p === this.phase) {
				return theme.fg("accent", p.charAt(0).toUpperCase() + p.slice(1));
			}
			if (this.completedPhases.includes(p)) {
				return theme.fg("success", `✓${p.charAt(0).toUpperCase()}`);
			}
			return theme.fg("dim", p.charAt(0).toUpperCase());
		});
		parts.push(phaseLabels.join(theme.fg("dim", " → ")));

		// Pass/batch info (only for multi-pass phases)
		if (this.maxPasses > 1) {
			const label = this.phase === "observer" ? "batch" : "pass";
			parts.push(theme.fg("muted", `${label} ${this.pass}/${this.maxPasses}`));
		}

		// Tool calls (only shown when non-zero — observer batches don't feed events)
		if (this.toolCallCount > 0) {
			const tcLabel = this.toolCallCount === 1 ? "tool call" : "tool calls";
			parts.push(theme.fg("muted", `${this.toolCallCount} ${tcLabel}`));
		}

		// Delta counters: R total(+accumulated), M total(+accumulated), O remaining(-accumulated)
		const deltas: string[] = [];
		if (this.reflectionsAdded > 0) {
			const total = this.startingReflections + this.reflectionsAdded;
			deltas.push(`R ${total}(+${this.reflectionsAdded})`);
		}
		if (this.reflectionsMerged > 0) {
			deltas.push(`M ${this.reflectionsMerged}`);
		}
		if (this.observationsDropped > 0) {
			const remaining = this.startingObservations - this.observationsDropped;
			deltas.push(`O ${remaining}(-${this.observationsDropped})`);
		}
		if (deltas.length > 0) {
			parts.push(theme.fg("accent", deltas.join(" ")));
		}

		// Trailing runtime cluster: {ctxUsed}/{contextWindow} · {tok} tok — the
		// compaction agent's own context consumption + live streaming output
		// tokens (NOT the main session's usage). Collapses to "?" (never "?/0")
		// before the phase's first message_end or when the window is unknown.
		const ctxPart = this.agentContextTokens === null ? "?" : formatTokens(this.agentContextTokens);
		const windowPart = this.contextWindow === null ? "" : `/${formatTokens(this.contextWindow)}`;
		parts.push(theme.fg("muted", `${ctxPart}${windowPart}`));
		parts.push(theme.fg("muted", `${formatTokens(this.streamingOutputTokens)} tok`));

		return parts.join(theme.fg("dim", " · "));
	}
}
