// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@earendil-works/pi-agent-core";
import { createUsageAccumulator } from "../src/usage-accumulator.js";

function messageEndWith(usage: unknown): AgentEvent {
	return { type: "message_end", message: { role: "assistant", content: [], stopReason: "stop", usage } } as unknown as AgentEvent;
}

function otherEvent(type: string): AgentEvent {
	return { type } as unknown as AgentEvent;
}

describe("UsageAccumulator", () => {
	it("sums usage across message_end events into pi's Usage shape (all fields finite)", () => {
		const acc = createUsageAccumulator();
		acc.onEvent(messageEndWith({ input: 100, output: 50, cacheRead: 5, cacheWrite: 8, totalTokens: 163, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.01 } }));
		acc.onEvent(messageEndWith({ input: 200, output: 60, cacheRead: 10, cacheWrite: 12, totalTokens: 282, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.02 } }));
		const u = acc.toUsage();
		expect(u).toEqual({
			input: 300,
			output: 110,
			cacheRead: 15,
			cacheWrite: 20,
			totalTokens: 445,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.03 },
		});
	});

	it("emits a fully-zero Usage (NEVER undefined) when no message_end was seen", () => {
		const acc = createUsageAccumulator();
		acc.onEvent(otherEvent("turn_end"));
		acc.onEvent(otherEvent("tool_execution_end"));
		const u = acc.toUsage();
		expect(u).toEqual({
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		});
		// finite-number guard (pi's addUsageToTotals has no nullish checks)
		expect(Number.isFinite(u.cost.total)).toBe(true);
		expect(Number.isFinite(u.cacheWrite)).toBe(true);
	});

	it("treats a message_end with no usage as zero (not NaN)", () => {
		const acc = createUsageAccumulator();
		acc.onEvent(messageEndWith(undefined));
		const u = acc.toUsage();
		expect(u.input).toBe(0);
		expect(u.cost.total).toBe(0);
	});

	it("treats missing usage sub-fields as zero (partial provider reporting)", () => {
		const acc = createUsageAccumulator();
		acc.onEvent(messageEndWith({ output: 77 }));
		const u = acc.toUsage();
		expect(u.output).toBe(77);
		expect(u.input).toBe(0);
		expect(u.cacheWrite).toBe(0);
		expect(u.cost.total).toBe(0);
	});
});
