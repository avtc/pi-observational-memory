import { describe, expect, it, vi } from "vitest";

import { AgentStreamError, drainAgentStream } from "../src/agent-stream.js";

/** Build a stream-like object from an explicit list of AgentEvents. */
function streamOf(events: Array<Record<string, unknown>>): {
	[Symbol.asyncIterator](): AsyncIterator<any>;
	result(): Promise<unknown>;
} {
	return {
		async *[Symbol.asyncIterator]() {
			for (const event of events) yield event;
		},
		result: async () => ({}),
	};
}

function assistantMessage(stopReason: string, errorMessage?: string) {
	return { role: "assistant", stopReason, errorMessage, content: [] };
}

describe("drainAgentStream", () => {
	it("forwards every event to onEvent and resolves on a normal completion", async () => {
		const seen: string[] = [];
		const stream = streamOf([
			{ type: "agent_start" },
			{ type: "turn_start" },
			{ type: "message_start", message: assistantMessage("end_turn") },
			{ type: "message_end", message: assistantMessage("end_turn") },
			{ type: "turn_end", message: assistantMessage("end_turn"), toolResults: [] },
			{ type: "agent_end", messages: [assistantMessage("end_turn")] },
		]);

		await drainAgentStream(stream as any, (event) => seen.push(event.type));

		expect(seen).toEqual([
			"agent_start",
			"turn_start",
			"message_start",
			"message_end",
			"turn_end",
			"agent_end",
		]);
	});

	it("awaits stream.result()", async () => {
		const result = vi.fn(async () => ({ ok: true }));
		const stream = {
			async *[Symbol.asyncIterator]() {
				yield { type: "agent_end", messages: [] };
			},
			result,
		};

		await drainAgentStream(stream as any);

		expect(result).toHaveBeenCalledTimes(1);
	});

	it("throws AgentStreamError when the final assistant message has stopReason error", async () => {
		const stream = streamOf([
			{ type: "message_start", message: assistantMessage("error", "connection refused") },
			{ type: "message_end", message: assistantMessage("error", "connection refused") },
			{ type: "turn_end", message: assistantMessage("error", "connection refused"), toolResults: [] },
			{ type: "agent_end", messages: [assistantMessage("error", "connection refused")] },
		]);

		await expect(drainAgentStream(stream as any)).rejects.toMatchObject({
			name: "AgentStreamError",
			stopReason: "error",
			modelErrorMessage: "connection refused",
		});
		await expect(drainAgentStream(stream as any)).rejects.toThrow(/connection refused/);
	});

	it("throws AgentStreamError for stopReason aborted", async () => {
		const stream = streamOf([
			{ type: "message_end", message: assistantMessage("aborted") },
			{ type: "agent_end", messages: [assistantMessage("aborted")] },
		]);

		await expect(drainAgentStream(stream as any)).rejects.toMatchObject({
			name: "AgentStreamError",
			stopReason: "aborted",
		});
	});

	it("does not throw when the model succeeded with a normal stop reason", async () => {
		const stream = streamOf([
			{ type: "message_end", message: assistantMessage("tool_calls") },
			{ type: "agent_end", messages: [assistantMessage("tool_calls")] },
		]);

		await expect(drainAgentStream(stream as any)).resolves.toBeUndefined();
	});

	it("treats a stream with no assistant message_end as a normal completion", async () => {
		// Mirrors the no-op test mocks used across the suite (no events emitted).
		const stream = streamOf([{ type: "agent_start" }, { type: "agent_end", messages: [] }]);

		await expect(drainAgentStream(stream as any)).resolves.toBeUndefined();
	});

	it("ignores non-assistant message_end events (tool results)", async () => {
		const stream = streamOf([
			{ type: "message_end", message: { role: "toolResult", content: [] } },
			{ type: "message_end", message: assistantMessage("end_turn") },
			{ type: "agent_end", messages: [] },
		]);

		await expect(drainAgentStream(stream as any)).resolves.toBeUndefined();
	});
});

describe("AgentStreamError", () => {
	it("includes the model error message in its message when present", () => {
		const error = new AgentStreamError("error", "model 'foo' not found");
		expect(error.message).toContain("stopReason \"error\"");
		expect(error.message).toContain("model 'foo' not found");
	});

	it("falls back to a stopReason-only message without detail", () => {
		const error = new AgentStreamError("aborted");
		expect(error.message).toBe('agent model call failed (stopReason "aborted")');
		expect(error.modelErrorMessage).toBeUndefined();
	});
});
