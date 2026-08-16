/**
 * Hook-level tests for the compaction widget's ctx-usage + streaming-token
 * cluster: the widget line must surface the compaction agent's own context
 * consumption ({used}/{window}) and the live streaming output-token counter
 * (two-tier: provider-streamed usage.output max + chars/4 delta fallback),
 * mirroring the memkeeper widget's trailing runtime cluster.
 */
import { describe, expect, it, vi } from "vitest";

const agentLoopMock = vi.hoisted(() => vi.fn());

vi.mock("@earendil-works/pi-agent-core", () => ({
	agentLoop: agentLoopMock,
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({
	getAgentDir: () => ({ agentDir: "" }),
	estimateTokens: (msg: any) => {
		if (typeof msg?.content === "string") return Math.ceil(msg.content.length / 4);
		return 0;
	},
}));

import { Text } from "@earendil-works/pi-tui";
import { registerCompactionHook } from "../src/hooks/compaction-hook.js";
import type { ObservationRecord } from "../src/types.js";
import { compactionEntry, messageEntry } from "./fixtures/session.js";

const observation: ObservationRecord = {
	id: "abc123def456",
	timestamp: "2026-05-02 10:30",
	relevance: "high",
	content: "User confirmed recall should use exact supporting source entry ids.",
	sourceEntryIds: ["source-before-compact"],
};

/** An agent stream that streams one generation with mid-stream usage and a
 *  final message_end carrying usage.totalTokens (the ctx-usage source). Between
 *  yields it advances fake timers so the widget's throttled trailing renders
 *  flush while the tracker is still mid-phase (deterministic assertions). */
function streamingAgentStream() {
	return {
		async *[Symbol.asyncIterator]() {
			yield { type: "message_start", message: {} };
			// fallback tier only: 400 chars → 100 tok
			yield {
				type: "message_update",
				message: {},
				assistantMessageEvent: { type: "text_delta", delta: "x".repeat(400) },
			};
			await vi.advanceTimersByTimeAsync(300);
			// primary tier pulls ahead: provider reports usage.output = 500
			yield {
				type: "message_update",
				message: { usage: { output: 500 } },
				assistantMessageEvent: { type: "text_delta", delta: "" },
			};
			await vi.advanceTimersByTimeAsync(300);
			yield {
				type: "message_end",
				message: { role: "assistant", usage: { input: 900, output: 500, totalTokens: 12_345 } },
			};
			await vi.advanceTimersByTimeAsync(300);
		},
		result: async () => ({}),
	};
}

describe("compaction widget ctx + streaming tokens", () => {
	it("renders the observer phase with ctx usage and streaming token progress", async () => {
		vi.useFakeTimers();
		try {
			agentLoopMock.mockReset();
			agentLoopMock.mockImplementation(() => streamingAgentStream());

			let handler: ((event: unknown, ctx: unknown) => Promise<unknown>) | undefined;
			const pi = {
				on: vi.fn((eventName: string, cb: typeof handler) => {
					expect(eventName).toBe("session_before_compact");
					handler = cb;
				}),
				appendEntry: vi.fn(),
			};
			const runtime = {
				compactHookInFlight: false,
				observerPromise: null,
				resolveFailureNotified: false,
				config: {
					enabled: true,
					observationThresholdTokens: 100_000, // one batch for the whole gap
					compactionThresholdTokens: 50_000,
					reflectionThresholdTokens: 10_000_000, // skip reflector/pruner
					passive: true,
					debugLog: false,
				},
				ensureConfig: vi.fn(),
				resolveModel: vi.fn(async () => ({
					ok: true,
					model: { contextWindow: 200_000 },
					apiKey: "test-key",
				})),
			};
			registerCompactionHook(pi as never, runtime as never);
			if (!handler) throw new Error("session_before_compact handler was not registered");

			const entries = [
				compactionEntry({
					id: "prior-compaction",
					firstKeptEntryId: "kept-1",
					details: {
						type: "observational-memory",
						version: 4,
						observations: [observation],
						reflections: [],
					},
				}),
				messageEntry({ id: "kept-1", message: { role: "user", content: "start of kept tail" } }),
				messageEntry({ id: "raw-1", message: { role: "user", content: "raw tail content" } }),
				messageEntry({ id: "new-boundary", message: { role: "user", content: "boundary" } }),
			];

			// Capture every rendered widget line (theme passthrough, no color).
			const widgetLines: string[] = [];
			const setWidget = vi.fn((_key: string, content: unknown) => {
				if (typeof content === "function") {
					const component = (content as (tui: unknown, theme: unknown) => Text)(
						{},
						{ fg: (_c: string, t: string) => t },
					);
					widgetLines.push(component.render(300)[0] ?? "");
				}
			});

			await handler(
				{
					preparation: { firstKeptEntryId: "new-boundary", tokensBefore: 50000 },
					branchEntries: entries,
					signal: undefined,
				},
				{
					cwd: "/tmp/project",
					hasUI: true,
					ui: { notify: vi.fn(), setWidget },
					sessionManager: { getBranch: vi.fn(() => entries) },
				},
			);

			expect(agentLoopMock).toHaveBeenCalled();
			expect(widgetLines.length).toBeGreaterThan(0);

			// While streaming (before message_end): the fallback-tier counter moves
			// and ctx usage is still unknown ("?").
			const midStream = widgetLines.find((line) => line.includes("100 tok"));
			expect(midStream).toBeDefined();
			expect(midStream).toContain("Observer");
			expect(midStream).toContain("?/200k");

			// After message_end: ctx usage 12k/200k + primary-tier streaming tokens.
			const finalObserver = widgetLines.find((line) => line.includes("12k/200k"));
			expect(finalObserver).toBeDefined();
			expect(finalObserver).toContain("Observer");
			expect(finalObserver).toContain("500 tok");
		} finally {
			vi.useRealTimers();
		}
	});
});
