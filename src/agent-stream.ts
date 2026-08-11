import type { AgentEvent } from "@earendil-works/pi-agent-core";

/**
 * Thrown when an agent-loop stream ends in a terminal model/runtime failure.
 *
 * Per the `StreamFn` contract (stable across pi 0.73 → 0.84), model and runtime
 * failures MUST NOT throw from the stream — they are encoded as a final
 * AssistantMessage carrying `stopReason` `"error"` or `"aborted"` (and an
 * `errorMessage`). A drain loop that only catches throws therefore misses the
 * most common failure modes (dead server, wrong model hosted, provider error)
 * and silently treats them as a successful-but-empty run.
 *
 * `drainAgentStream` is the single chokepoint that translates that
 * failure-encoding contract into a thrown error, so the observer/reflector/
 * pruner drain loops can rely on their existing try/catch failure handling
 * (reflector `stats.failed`, pruner `fellBack`, observer/catch-up cancellation).
 */
export class AgentStreamError extends Error {
	readonly stopReason: "error" | "aborted";
	readonly modelErrorMessage?: string;

	constructor(stopReason: "error" | "aborted", modelErrorMessage?: string) {
		const detail = modelErrorMessage?.trim();
		super(
			detail
				? `agent model call failed (stopReason "${stopReason}"): ${detail}`
				: `agent model call failed (stopReason "${stopReason}")`,
		);
		this.name = "AgentStreamError";
		this.stopReason = stopReason;
		this.modelErrorMessage = detail || undefined;
	}
}

interface AgentMessageLike {
	role?: string;
	stopReason?: string;
	errorMessage?: string;
}

interface AgentStreamLike {
	[Symbol.asyncIterator](): AsyncIterator<AgentEvent>;
	result(): Promise<unknown>;
}

/**
 * Drain an agent-loop event stream, forwarding each event to `onEvent`, then
 * await `stream.result()`. Throws {@link AgentStreamError} if the run ended in
 * a model/runtime failure — i.e. the final assistant message had
 * `stopReason` `"error"` or `"aborted"`.
 *
 * The last assistant `message_end` event is authoritative: the agent loop stops
 * immediately after a terminal failure, so that message's stopReason is the
 * run's outcome. A stream that never emits an assistant `message_end` (e.g. a
 * no-op test mock) is treated as a normal completion with no records — matching
 * the prior "model succeeded, produced nothing" semantics.
 */
export async function drainAgentStream(
	stream: AgentStreamLike,
	onEvent?: (event: AgentEvent) => void,
): Promise<void> {
	let lastAssistantStopReason: string | undefined;
	let lastAssistantErrorMessage: string | undefined;

	for await (const event of stream) {
		if (event.type === "message_end") {
			const message = event.message as AgentMessageLike;
			if (message.role === "assistant") {
				lastAssistantStopReason = message.stopReason;
				lastAssistantErrorMessage = message.errorMessage;
			}
		}
		onEvent?.(event);
	}

	await stream.result();

	if (lastAssistantStopReason === "error" || lastAssistantStopReason === "aborted") {
		throw new AgentStreamError(lastAssistantStopReason, lastAssistantErrorMessage);
	}
}
