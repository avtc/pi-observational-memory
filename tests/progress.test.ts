import { describe, expect, it } from "vitest";
import { CompactionProgressTracker } from "../src/progress.js";
import { formatTokens } from "../src/tokens.js";

describe("formatTokens", () => {
	it("formats plain numbers below 1k", () => {
		expect(formatTokens(0)).toBe("0");
		expect(formatTokens(999)).toBe("999");
	});

	it("formats k with one decimal below 10k and rounded above", () => {
		expect(formatTokens(1000)).toBe("1.0k");
		expect(formatTokens(9500)).toBe("9.5k");
		expect(formatTokens(15_000)).toBe("15k");
		expect(formatTokens(999_999)).toBe("1000k");
	});

	it("formats M with one decimal below 10M and rounded above", () => {
		expect(formatTokens(1_500_000)).toBe("1.5M");
		expect(formatTokens(15_000_000)).toBe("15M");
	});
});

describe("CompactionProgressTracker", () => {
	it("starts in idle state with no phase", () => {
		const tracker = new CompactionProgressTracker();
		expect(tracker.getPhase()).toBeUndefined();
		expect(tracker.getPass()).toBe(0);
		expect(tracker.getMaxPasses()).toBe(0);
		expect(tracker.getToolCallCount()).toBe(0);
		expect(tracker.getTurnCount()).toBe(0);
	});

	it("transitions to observer phase", () => {
		const tracker = new CompactionProgressTracker();
		tracker.setPhase("observer", 1, 1);
		expect(tracker.getPhase()).toBe("observer");
		expect(tracker.getPass()).toBe(1);
		expect(tracker.getMaxPasses()).toBe(1);
	});

	it("transitions to reflector phase with pass info", () => {
		const tracker = new CompactionProgressTracker();
		tracker.setPhase("reflector", 1, 3);
		expect(tracker.getPhase()).toBe("reflector");
		expect(tracker.getPass()).toBe(1);
		expect(tracker.getMaxPasses()).toBe(3);
	});

	it("transitions to pruner phase with pass info", () => {
		const tracker = new CompactionProgressTracker();
		tracker.setPhase("pruner", 2, 5);
		expect(tracker.getPhase()).toBe("pruner");
		expect(tracker.getPass()).toBe(2);
		expect(tracker.getMaxPasses()).toBe(5);
	});

	it("counts tool calls from agent events", () => {
		const tracker = new CompactionProgressTracker();
		tracker.setPhase("reflector", 1, 3);
		tracker.onEvent({ type: "tool_execution_start", toolCallId: "tc1", toolName: "record_reflections", args: {} });
		tracker.onEvent({ type: "tool_execution_end", toolCallId: "tc1", toolName: "record_reflections", result: {}, isError: false });
		tracker.onEvent({ type: "tool_execution_start", toolCallId: "tc2", toolName: "record_reflections", args: {} });
		expect(tracker.getToolCallCount()).toBe(2);
	});

	it("counts turns from agent events", () => {
		const tracker = new CompactionProgressTracker();
		tracker.setPhase("pruner", 1, 5);
		tracker.onEvent({ type: "turn_start" });
		tracker.onEvent({ type: "turn_end", message: {} as any, toolResults: [] });
		tracker.onEvent({ type: "turn_start" });
		expect(tracker.getTurnCount()).toBe(2);
	});

	it("formats widget text for reflector phase", () => {
		const tracker = new CompactionProgressTracker();
		tracker.setPhase("reflector", 2, 3);
		tracker.onEvent({ type: "tool_execution_start", toolCallId: "tc1", toolName: "record_reflections", args: {} });
		const text = tracker.formatWidget({
			fg: (color: string, t: string) => `<${color}>${t}</>`,
		});
		expect(text).toContain("Reflector");
		expect(text).toContain("2/3");
		expect(text).toContain("1 tool call");
	});

	it("formats widget text for pruner phase with observations dropped", () => {
		const tracker = new CompactionProgressTracker();
		tracker.setStartingCounts(10, 100);
		tracker.setPhase("pruner", 3, 5);
		tracker.onEvent({ type: "tool_execution_start", toolCallId: "tc1", toolName: "drop_observations", args: {} });
		tracker.onEvent({
			type: "tool_execution_end",
			toolCallId: "tc1",
			toolName: "drop_observations",
			result: { content: [], details: { dropped: Array.from({ length: 7 }, (_, i) => `o${i}`), unknown: [], already: [], remaining: 3 } },
			isError: false,
		});
		const text = tracker.formatWidget({
			fg: (color: string, t: string) => `<${color}>${t}</>`,
		});
		expect(text).toContain("Pruner");
		expect(text).toContain("3/5");
		expect(text).toContain("O 93(-7)");
	});

	it("formats widget text for observer phase", () => {
		const tracker = new CompactionProgressTracker();
		tracker.setPhase("observer", 1, 1);
		tracker.onEvent({ type: "tool_execution_start", toolCallId: "tc1", toolName: "record_observations", args: {} });
		const text = tracker.formatWidget({
			fg: (color: string, t: string) => `<${color}>${t}</>`,
		});
		expect(text).toContain("Observer");
	});

	it("shows 'batch N/M' for observer phase with multiple batches", () => {
		const tracker = new CompactionProgressTracker();
		tracker.setPhase("observer", 3, 15);
		const text = tracker.formatWidget({
			fg: (_c: string, t: string) => t,
		});
		expect(text).toContain("batch 3/15");
		expect(text).not.toContain("pass");
	});

	it("shows 'pass N/M' for reflector phase with multiple passes", () => {
		const tracker = new CompactionProgressTracker();
		tracker.setPhase("reflector", 2, 3);
		const text = tracker.formatWidget({
			fg: (_c: string, t: string) => t,
		});
		expect(text).toContain("pass 2/3");
		expect(text).not.toContain("batch");
	});

	it("resets counts when phase changes", () => {
		const tracker = new CompactionProgressTracker();
		tracker.setPhase("reflector", 1, 3);
		tracker.onEvent({ type: "tool_execution_start", toolCallId: "tc1", toolName: "record_reflections", args: {} });
		tracker.onEvent({ type: "turn_start" });
		// Change phase
		tracker.setPhase("pruner", 1, 5);
		expect(tracker.getToolCallCount()).toBe(0);
		expect(tracker.getTurnCount()).toBe(0);
	});

	it("clears state", () => {
		const tracker = new CompactionProgressTracker();
		tracker.setPhase("reflector", 1, 3);
		tracker.onEvent({ type: "tool_execution_start", toolCallId: "tc1", toolName: "record_reflections", args: {} });
		tracker.clear();
		expect(tracker.getPhase()).toBeUndefined();
		expect(tracker.getToolCallCount()).toBe(0);
	});

	it("ignores events when no phase is set", () => {
		const tracker = new CompactionProgressTracker();
		tracker.onEvent({ type: "tool_execution_start", toolCallId: "tc1", toolName: "record_reflections", args: {} });
		expect(tracker.getToolCallCount()).toBe(0);
	});

	it("renders pipeline overview with completed phases", () => {
		const tracker = new CompactionProgressTracker();
		tracker.setCompletedPhases(["observer"]);
		tracker.setPhase("reflector", 2, 3);
		const text = tracker.formatWidget({
			fg: (color: string, t: string) => `<${color}>${t}</>`,
		});
		expect(text).toContain("✓O"); // completed observer
		expect(text).toContain("Reflector"); // active
	});

	it("auto-marks previous phase as completed when transitioning to a new phase", () => {
		const tracker = new CompactionProgressTracker();
		tracker.setPhase("observer", 1, 1);
		tracker.setPhase("reflector", 1, 3);
		const text = tracker.formatWidget({
			fg: (color: string, t: string) => `<${color}>${t}</>`,
		});
		expect(text).toContain("✓O"); // auto-completed observer
		expect(text).toContain("Reflector"); // active
	});

	it("uses singular 'tool call' for 1 and plural for 2+", () => {
		const tracker = new CompactionProgressTracker();
		tracker.setPhase("reflector", 1, 3);
		let text = tracker.formatWidget({ fg: (_c: string, t: string) => t });
		// Tool calls hidden when 0 (observer batches don't feed events)
		expect(text).not.toContain("tool call");
		tracker.onEvent({ type: "tool_execution_start", toolCallId: "tc1", toolName: "r", args: {} });
		text = tracker.formatWidget({ fg: (_c: string, t: string) => t });
		expect(text).toContain("1 tool call");
		tracker.onEvent({ type: "tool_execution_start", toolCallId: "tc2", toolName: "r", args: {} });
		text = tracker.formatWidget({ fg: (_c: string, t: string) => t });
		expect(text).toContain("2 tool calls");
	});

	it("returns empty string when no phase is set for formatWidget", () => {
		const tracker = new CompactionProgressTracker();
		expect(tracker.formatWidget({ fg: (_c: string, t: string) => t })).toBe("");
	});

	// --- Delta counters: R total(+accumulated), M total, O remaining(-accumulated) ---

	it("tracks reflections added from record_reflections tool_execution_end", () => {
		const tracker = new CompactionProgressTracker();
		tracker.setPhase("reflector", 1, 3);
		tracker.setStartingCounts(15, 50);
		tracker.onEvent({ type: "tool_execution_start", toolCallId: "tc1", toolName: "record_reflections", args: {} });
		tracker.onEvent({
			type: "tool_execution_end",
			toolCallId: "tc1",
			toolName: "record_reflections",
			result: {
				content: [{ type: "text", text: "ok" }],
				details: { accepted: 3, added: 2, merged: 1, duplicates: 0, unsupported: 0 },
			},
			isError: false,
		});
		const text = tracker.formatWidget({ fg: (_c: string, t: string) => t });
		expect(text).toContain("R 17(+2)");
		expect(text).toContain("M 1");
	});

	it("accumulates reflection deltas across multiple tool calls in same pass", () => {
		const tracker = new CompactionProgressTracker();
		tracker.setPhase("reflector", 1, 3);
		tracker.setStartingCounts(10, 50);
		// First call: 3 added, 1 merged
		tracker.onEvent({ type: "tool_execution_start", toolCallId: "tc1", toolName: "record_reflections", args: {} });
		tracker.onEvent({
			type: "tool_execution_end",
			toolCallId: "tc1",
			toolName: "record_reflections",
			result: { content: [], details: { accepted: 4, added: 3, merged: 1, duplicates: 0, unsupported: 0 } },
			isError: false,
		});
		// Second call: 2 added, 0 merged
		tracker.onEvent({ type: "tool_execution_start", toolCallId: "tc2", toolName: "record_reflections", args: {} });
		tracker.onEvent({
			type: "tool_execution_end",
			toolCallId: "tc2",
			toolName: "record_reflections",
			result: { content: [], details: { accepted: 2, added: 2, merged: 0, duplicates: 0, unsupported: 0 } },
			isError: false,
		});
		const text = tracker.formatWidget({ fg: (_c: string, t: string) => t });
		expect(text).toContain("R 15(+5)");
		expect(text).toContain("M 1");
	});

	it("does not show R/M when no reflections added or merged", () => {
		const tracker = new CompactionProgressTracker();
		tracker.setPhase("reflector", 1, 3);
		tracker.onEvent({ type: "tool_execution_start", toolCallId: "tc1", toolName: "record_reflections", args: {} });
		tracker.onEvent({
			type: "tool_execution_end",
			toolCallId: "tc1",
			toolName: "record_reflections",
			result: { content: [], details: { accepted: 0, added: 0, merged: 0, duplicates: 2, unsupported: 0 } },
			isError: false,
		});
		const text = tracker.formatWidget({ fg: (_c: string, t: string) => t });
		expect(text).not.toContain("R ");
		expect(text).not.toContain("M ");
	});

	it("tracks observations dropped from drop_observations tool_execution_end", () => {
		const tracker = new CompactionProgressTracker();
		tracker.setPhase("pruner", 1, 5);
		tracker.setStartingCounts(10, 20);
		tracker.onEvent({ type: "tool_execution_start", toolCallId: "tc1", toolName: "drop_observations", args: {} });
		tracker.onEvent({
			type: "tool_execution_end",
			toolCallId: "tc1",
			toolName: "drop_observations",
			result: {
				content: [{ type: "text", text: "ok" }],
				details: { dropped: ["o1", "o2", "o3"], unknown: [], already: [], remaining: 10 },
			},
			isError: false,
		});
		const text = tracker.formatWidget({ fg: (_c: string, t: string) => t });
		expect(text).toContain("O 17(-3)");
	});

	it("accumulates observation drops across multiple tool calls in same pass", () => {
		const tracker = new CompactionProgressTracker();
		tracker.setPhase("pruner", 1, 5);
		tracker.setStartingCounts(10, 300);
		// First call: drop 4
		tracker.onEvent({ type: "tool_execution_start", toolCallId: "tc1", toolName: "drop_observations", args: {} });
		tracker.onEvent({
			type: "tool_execution_end",
			toolCallId: "tc1",
			toolName: "drop_observations",
			result: { content: [], details: { dropped: ["a", "b", "c", "d"], unknown: [], already: [], remaining: 8 } },
			isError: false,
		});
		// Second call: drop 3
		tracker.onEvent({ type: "tool_execution_start", toolCallId: "tc2", toolName: "drop_observations", args: {} });
		tracker.onEvent({
			type: "tool_execution_end",
			toolCallId: "tc2",
			toolName: "drop_observations",
			result: { content: [], details: { dropped: ["e", "f", "g"], unknown: [], already: [], remaining: 5 } },
			isError: false,
		});
		const text = tracker.formatWidget({ fg: (_c: string, t: string) => t });
		expect(text).toContain("O 293(-7)");
	});

	it("shows O remaining(-accumulated) delta format for pruner", () => {
		const tracker = new CompactionProgressTracker();
		tracker.setPhase("pruner", 1, 5);
		tracker.setStartingCounts(10, 100);
		tracker.onEvent({ type: "tool_execution_start", toolCallId: "tc1", toolName: "drop_observations", args: {} });
		tracker.onEvent({
			type: "tool_execution_end",
			toolCallId: "tc1",
			toolName: "drop_observations",
			result: { content: [], details: { dropped: ["o1"], unknown: [], already: [], remaining: 9 } },
			isError: false,
		});
		const text = tracker.formatWidget({ fg: (_c: string, t: string) => t });
		expect(text).toContain("O 99(-1)");
		expect(text).not.toContain("dropped");
	});

	it("preserves deltas across passes within same phase", () => {
		const tracker = new CompactionProgressTracker();
		tracker.setStartingCounts(10, 50);
		tracker.setPhase("reflector", 1, 3);
		tracker.onEvent({ type: "tool_execution_start", toolCallId: "tc1", toolName: "record_reflections", args: {} });
		tracker.onEvent({
			type: "tool_execution_end",
			toolCallId: "tc1",
			toolName: "record_reflections",
			result: { content: [], details: { accepted: 3, added: 3, merged: 0, duplicates: 0, unsupported: 0 } },
			isError: false,
		});
		// Pass 2 — same phase, deltas should accumulate
		tracker.setPhase("reflector", 2, 3);
		tracker.onEvent({ type: "tool_execution_start", toolCallId: "tc2", toolName: "record_reflections", args: {} });
		tracker.onEvent({
			type: "tool_execution_end",
			toolCallId: "tc2",
			toolName: "record_reflections",
			result: { content: [], details: { accepted: 2, added: 2, merged: 1, duplicates: 0, unsupported: 0 } },
			isError: false,
		});
		const text = tracker.formatWidget({ fg: (_c: string, t: string) => t });
		expect(text).toContain("R 15(+5)");
		expect(text).toContain("M 1");
	});

	it("resets deltas when phase changes", () => {
		const tracker = new CompactionProgressTracker();
		tracker.setStartingCounts(10, 50);
		tracker.setPhase("reflector", 1, 3);
		tracker.onEvent({ type: "tool_execution_start", toolCallId: "tc1", toolName: "record_reflections", args: {} });
		tracker.onEvent({
			type: "tool_execution_end",
			toolCallId: "tc1",
			toolName: "record_reflections",
			result: { content: [], details: { accepted: 2, added: 2, merged: 0, duplicates: 0, unsupported: 0 } },
			isError: false,
		});
		// Transition to pruner — deltas reset
		tracker.setPhase("pruner", 1, 5);
		const text = tracker.formatWidget({ fg: (_c: string, t: string) => t });
		expect(text).not.toContain("R 12(+2)");
	});

	it("ignores tool_execution_end for unknown tools", () => {
		const tracker = new CompactionProgressTracker();
		tracker.setStartingCounts(10, 50);
		tracker.setPhase("reflector", 1, 3);
		tracker.onEvent({ type: "tool_execution_start", toolCallId: "tc1", toolName: "record_reflections", args: {} });
		tracker.onEvent({
			type: "tool_execution_end",
			toolCallId: "tc1",
			toolName: "some_other_tool",
			result: { content: [], details: { accepted: 5, added: 5, merged: 0, duplicates: 0, unsupported: 0 } },
			isError: false,
		});
		const text = tracker.formatWidget({ fg: (_c: string, t: string) => t });
		expect(text).not.toContain("R 15(+5)");
	});

	it("ignores tool_execution_end with missing details", () => {
		const tracker = new CompactionProgressTracker();
		tracker.setStartingCounts(10, 50);
		tracker.setPhase("pruner", 1, 5);
		tracker.onEvent({ type: "tool_execution_start", toolCallId: "tc1", toolName: "drop_observations", args: {} });
		tracker.onEvent({
			type: "tool_execution_end",
			toolCallId: "tc1",
			toolName: "drop_observations",
			result: { content: [] }, // no details
			isError: false,
		});
		const text = tracker.formatWidget({ fg: (_c: string, t: string) => t });
		expect(text).not.toContain("O 50(-1)");
	});

	it("ignores tool_execution_end when isError is true", () => {
		const tracker = new CompactionProgressTracker();
		tracker.setStartingCounts(10, 50);
		tracker.setPhase("reflector", 1, 3);
		tracker.onEvent({ type: "tool_execution_start", toolCallId: "tc1", toolName: "record_reflections", args: {} });
		tracker.onEvent({
			type: "tool_execution_end",
			toolCallId: "tc1",
			toolName: "record_reflections",
			result: { content: [], details: { accepted: 5, added: 5, merged: 0, duplicates: 0, unsupported: 0 } },
			isError: true,
		});
		const text = tracker.formatWidget({ fg: (_c: string, t: string) => t });
		expect(text).not.toContain("R 15(+5)");
	});
});

describe("CompactionProgressTracker ctx + streaming tokens", () => {
	const theme = { fg: (_c: string, t: string) => t };

	function textDelta(delta: string, usage?: { output?: number }) {
		return {
			type: "message_update",
			message: usage ? ({ usage } as any) : ({} as any),
			assistantMessageEvent: { type: "text_delta", delta },
		} as any;
	}

	function messageEnd(usage: { totalTokens?: number; output?: number; input?: number }) {
		return { type: "message_end", message: { role: "assistant", usage } } as any;
	}

	it("shows '?/window · 0 tok' when a phase is active but nothing streamed yet", () => {
		const tracker = new CompactionProgressTracker();
		tracker.setContextWindow(200_000);
		tracker.setPhase("reflector", 1, 3);
		const text = tracker.formatWidget(theme);
		expect(text).toContain("?/200k");
		expect(text).toContain("0 tok");
	});

	it("shows ctx usage without a denominator when the window is unknown", () => {
		const tracker = new CompactionProgressTracker();
		tracker.setPhase("observer", 1, 1);
		tracker.onEvent(messageEnd({ totalTokens: 12_345 }));
		const text = tracker.formatWidget(theme);
		expect(text).toContain("12k · ");
		expect(text).not.toContain("?/");
	});

	it("tracks per-agent ctx usage from message_end usage.totalTokens", () => {
		const tracker = new CompactionProgressTracker();
		tracker.setContextWindow(200_000);
		tracker.setPhase("reflector", 1, 3);
		tracker.onEvent(messageEnd({ totalTokens: 45_000 }));
		expect(tracker.getContextTokens()).toBe(45_000);
		const text = tracker.formatWidget(theme);
		expect(text).toContain("45k/200k");
	});

	it("accumulates streamed text deltas as the fallback token tier (chars/4)", () => {
		const tracker = new CompactionProgressTracker();
		tracker.setPhase("observer", 1, 2);
		tracker.onEvent(textDelta("a".repeat(200)));
		tracker.onEvent(textDelta("b".repeat(200)));
		expect(tracker.getStreamingOutputTokens()).toBe(100);
		const text = tracker.formatWidget(theme);
		expect(text).toContain("100 tok");
	});

	it("uses provider-streamed usage.output as the primary tier when larger", () => {
		const tracker = new CompactionProgressTracker();
		tracker.setPhase("pruner", 1, 5);
		tracker.onEvent(textDelta("x".repeat(40))); // fallback: 10
		tracker.onEvent(textDelta("y".repeat(40), { output: 500 })); // primary: 500
		expect(tracker.getStreamingOutputTokens()).toBe(500);
	});

	it("keeps whichever tier is further along (max, not primary-wins)", () => {
		const tracker = new CompactionProgressTracker();
		tracker.setPhase("pruner", 1, 5);
		tracker.onEvent(textDelta("z".repeat(400), { output: 50 })); // primary 50, fallback 100
		expect(tracker.getStreamingOutputTokens()).toBe(100);
		tracker.onEvent(textDelta("w".repeat(400), { output: 30 })); // primary never moves back
		expect(tracker.getStreamingOutputTokens()).toBe(200);
	});

	it("counts thinking/toolcall deltas in the fallback tier", () => {
		const tracker = new CompactionProgressTracker();
		tracker.setPhase("reflector", 1, 3);
		tracker.onEvent({
			type: "message_update",
			message: {} as any,
			assistantMessageEvent: { type: "thinking_delta", delta: "t".repeat(80) },
		} as any);
		tracker.onEvent({
			type: "message_update",
			message: {} as any,
			assistantMessageEvent: { type: "toolcall_delta", delta: "c".repeat(120) },
		} as any);
		expect(tracker.getStreamingOutputTokens()).toBe(50);
	});

	it("resets the streaming counter per message_start (per generation)", () => {
		const tracker = new CompactionProgressTracker();
		tracker.setPhase("observer", 1, 2);
		tracker.onEvent(textDelta("a".repeat(400)));
		expect(tracker.getStreamingOutputTokens()).toBe(100);
		tracker.onEvent({ type: "message_start", message: {} as any } as any);
		expect(tracker.getStreamingOutputTokens()).toBe(0);
		const text = tracker.formatWidget(theme);
		expect(text).toContain("0 tok");
	});

	it("preserves ctx usage across passes within a phase", () => {
		const tracker = new CompactionProgressTracker();
		tracker.setContextWindow(100_000);
		tracker.setPhase("reflector", 1, 3);
		tracker.onEvent(messageEnd({ totalTokens: 30_000 }));
		tracker.setPhase("reflector", 2, 3);
		expect(tracker.getContextTokens()).toBe(30_000);
	});

	it("resets ctx usage and streaming when the phase changes", () => {
		const tracker = new CompactionProgressTracker();
		tracker.setContextWindow(100_000);
		tracker.setPhase("reflector", 1, 3);
		tracker.onEvent(messageEnd({ totalTokens: 30_000 }));
		tracker.onEvent(textDelta("a".repeat(400)));
		tracker.setPhase("pruner", 1, 5);
		expect(tracker.getContextTokens()).toBeNull();
		expect(tracker.getStreamingOutputTokens()).toBe(0);
		const text = tracker.formatWidget(theme);
		expect(text).toContain("?/100k");
		expect(text).toContain("0 tok");
	});

	it("keeps the context window across phase changes", () => {
		const tracker = new CompactionProgressTracker();
		tracker.setContextWindow(128_000);
		tracker.setPhase("observer", 1, 1);
		tracker.setPhase("reflector", 1, 3);
		const text = tracker.formatWidget(theme);
		expect(text).toContain("?/128k");
	});

	it("clear() resets ctx + streaming state", () => {
		const tracker = new CompactionProgressTracker();
		tracker.setContextWindow(100_000);
		tracker.setPhase("reflector", 1, 3);
		tracker.onEvent(messageEnd({ totalTokens: 30_000 }));
		tracker.onEvent(textDelta("a".repeat(400)));
		tracker.clear();
		expect(tracker.getContextTokens()).toBeNull();
		expect(tracker.getContextWindow()).toBeNull();
		expect(tracker.getStreamingOutputTokens()).toBe(0);
	});

	it("ignores events when no phase is set", () => {
		const tracker = new CompactionProgressTracker();
		tracker.setContextWindow(100_000);
		tracker.onEvent(messageEnd({ totalTokens: 30_000 }));
		tracker.onEvent(textDelta("a".repeat(400)));
		expect(tracker.getContextTokens()).toBeNull();
		expect(tracker.getStreamingOutputTokens()).toBe(0);
	});

	it("ignores message_end without usage", () => {
		const tracker = new CompactionProgressTracker();
		tracker.setPhase("reflector", 1, 3);
		tracker.onEvent({ type: "message_end", message: { role: "user" } } as any);
		expect(tracker.getContextTokens()).toBeNull();
	});
});
