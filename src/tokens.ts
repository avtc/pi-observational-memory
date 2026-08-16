import { estimateTokens as estimateMessageTokens } from "@earendil-works/pi-coding-agent";

export function estimateStringTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

const THOUSAND = 1000;
const TEN_THOUSAND = 10_000;
const MILLION = 1_000_000;
const TEN_MILLION = 10_000_000;
const BILLION = 1_000_000_000;
const TEN_BILLION = 10_000_000_000;

/** Format a token count with adaptive k/M/B suffix and one-decimal-below-10
 *  (mirrors pi's footer logic — 999 stays plain, 9500 → "9.5k", 15000 → "15k"). */
export function formatTokens(n: number): string {
	if (n < THOUSAND) return String(n);
	if (n < TEN_THOUSAND) return `${(n / THOUSAND).toFixed(1)}k`;
	if (n < MILLION) return `${Math.round(n / THOUSAND)}k`;
	if (n < TEN_MILLION) return `${(n / MILLION).toFixed(1)}M`;
	if (n < BILLION) return `${Math.round(n / MILLION)}M`;
	if (n < TEN_BILLION) return `${(n / TEN_BILLION).toFixed(1)}B`;
	return `${Math.round(n / BILLION)}B`;
}

export function estimateEntryTokens(entry: { type: string; message?: unknown; content?: unknown; summary?: unknown }): number {
	if (entry.type === "message" && entry.message) {
		return estimateMessageTokens(entry.message as Parameters<typeof estimateMessageTokens>[0]);
	}
	if (entry.type === "custom_message" && entry.content) {
		const content = entry.content;
		if (typeof content === "string") return estimateStringTokens(content);
		if (Array.isArray(content)) {
			let total = 0;
			for (const block of content) {
				if (block.type === "text" && block.text) total += estimateStringTokens(block.text);
			}
			return total;
		}
	}
	if (entry.type === "branch_summary" && typeof entry.summary === "string") {
		return estimateStringTokens(entry.summary);
	}
	return 0;
}

