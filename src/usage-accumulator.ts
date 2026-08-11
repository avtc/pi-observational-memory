// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

// A tiny usage accumulator fed by an agent-loop `onEvent` sink. Reads
// `message_end.message.usage` (where pi providers report token/cost) and sums
// it into pi's `Usage` shape. Used by the compaction hook to capture the
// catch-up Observer + reflector + pruner LLM cost so `compaction.usage` can be
// returned (the bench reads it for the per-compaction cost metric).
//
// Patch contract: every field is a finite number (0, never undefined) and
// `cost` is always `{total: number}` — pi's `addUsageToTotals` has no nullish
// guards, so partial emission NaN-propagates / crashes `getSessionStats`.

import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";

interface UsageAccumulator {
	/** Feed an agent event; message_end events carrying usage are summed. */
	onEvent(event: AgentEvent): void;
	/** The accumulated pi-Usage (all fields finite; zero when nothing was seen). */
	toUsage(): Usage;
}

/** A usage slice as it appears on a message_end message (all fields optional —
 *  providers report varying subsets; missing → 0). */
interface MessageUsageLike {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	totalTokens?: number;
	cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number };
}

export function createUsageAccumulator(): UsageAccumulator {
	let input = 0;
	let output = 0;
	let cacheRead = 0;
	let cacheWrite = 0;
	let totalTokens = 0;
	let costInput = 0;
	let costOutput = 0;
	let costCacheRead = 0;
	let costCacheWrite = 0;
	let costTotal = 0;

	return {
		onEvent(event: AgentEvent): void {
			if (event.type !== "message_end") return;
			const usage = (event as { message?: { usage?: MessageUsageLike } }).message?.usage;
			if (usage === undefined) return;
			input += usage.input ?? 0;
			output += usage.output ?? 0;
			cacheRead += usage.cacheRead ?? 0;
			cacheWrite += usage.cacheWrite ?? 0;
			totalTokens += usage.totalTokens ?? 0;
			const cost = usage.cost;
			if (cost !== undefined) {
				costInput += cost.input ?? 0;
				costOutput += cost.output ?? 0;
				costCacheRead += cost.cacheRead ?? 0;
				costCacheWrite += cost.cacheWrite ?? 0;
				costTotal += cost.total ?? 0;
			}
		},
		toUsage(): Usage {
			return {
				input,
				output,
				cacheRead,
				cacheWrite,
				totalTokens,
				cost: { input: costInput, output: costOutput, cacheRead: costCacheRead, cacheWrite: costCacheWrite, total: costTotal },
			};
		},
	};
}

/** Sum N pi-Usage objects into one (all fields finite). */
export function sumUsages(usages: readonly Usage[]): Usage {
	let input = 0;
	let output = 0;
	let cacheRead = 0;
	let cacheWrite = 0;
	let totalTokens = 0;
	let costInput = 0;
	let costOutput = 0;
	let costCacheRead = 0;
	let costCacheWrite = 0;
	let costTotal = 0;
	for (const u of usages) {
		input += u.input;
		output += u.output;
		cacheRead += u.cacheRead;
		cacheWrite += u.cacheWrite;
		totalTokens += u.totalTokens;
		costInput += u.cost.input;
		costOutput += u.cost.output;
		costCacheRead += u.cost.cacheRead;
		costCacheWrite += u.cost.cacheWrite;
		costTotal += u.cost.total;
	}
	return {
		input,
		output,
		cacheRead,
		cacheWrite,
		totalTokens,
		cost: { input: costInput, output: costOutput, cacheRead: costCacheRead, cacheWrite: costCacheWrite, total: costTotal },
	};
}
