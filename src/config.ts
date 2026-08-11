import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface Config {
	enabled: boolean;
	observationThresholdTokens: number;
	compactionThresholdTokens: number;
	reflectionThresholdTokens: number;
	passive: boolean;
	debugLog: boolean;
	compactionModel?: { provider: string; id: string };
	observerMaxTurnsPerRun?: number;
	reflectorMaxTurnsPerPass?: number;
	prunerMaxTurnsPerPass?: number;
	thinkingLevel: ModelThinkingLevel;
	/** @deprecated Use reflectorMaxTurnsPerPass and prunerMaxTurnsPerPass. */
	compactionMaxToolCalls?: number;
}

export interface EffectiveTurnLimits {
	observerMaxTurnsPerRun: number;
	reflectorMaxTurnsPerPass: number;
	prunerMaxTurnsPerPass: number;
}

export const DEFAULTS: Config = {
	enabled: true,
	observationThresholdTokens: 1_000,
	compactionThresholdTokens: 50_000,
	reflectionThresholdTokens: 30_000,
	passive: false,
	debugLog: false,
	thinkingLevel: "low",
};

export const THINKING_LEVEL_VALUES: readonly ModelThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

const SETTINGS_KEY = "observational-memory";
const PASSIVE_ENV = "PI_OBSERVATIONAL_MEMORY_PASSIVE";
const ENABLED_ENV = "PI_OBSERVATIONAL_MEMORY_ENABLED";
const DEFAULT_MAX_TURNS = 16;

function positiveIntegerOrUndefined(value: unknown): number | undefined {
	return Number.isInteger(value) && typeof value === "number" && value > 0 ? value : undefined;
}

function normalizeTurnLimit<K extends keyof Config>(normalized: Partial<Config>, key: K): void {
	if (!(key in normalized)) return;
	const value = positiveIntegerOrUndefined(normalized[key]);
	if (value === undefined) {
		delete normalized[key];
	} else {
		(normalized as Record<K, number>)[key] = value;
	}
}

function isThinkingLevel(value: unknown): value is ModelThinkingLevel {
	return typeof value === "string" && (THINKING_LEVEL_VALUES as readonly string[]).includes(value);
}

function normalizeThinkingLevel(normalized: Partial<Config>): void {
	if (!("thinkingLevel" in normalized)) return;
	if (!isThinkingLevel(normalized.thinkingLevel)) delete normalized.thinkingLevel;
}

function normalizeSettingsConfig(value: Partial<Config>): Partial<Config> {
	const normalized = { ...value };
	if ("enabled" in normalized && typeof normalized.enabled !== "boolean") delete normalized.enabled;
	if ("passive" in normalized && typeof normalized.passive !== "boolean") delete normalized.passive;
	if ("debugLog" in normalized && typeof normalized.debugLog !== "boolean") delete normalized.debugLog;
	normalizeTurnLimit(normalized, "observerMaxTurnsPerRun");
	normalizeTurnLimit(normalized, "reflectorMaxTurnsPerPass");
	normalizeTurnLimit(normalized, "prunerMaxTurnsPerPass");
	normalizeTurnLimit(normalized, "compactionMaxToolCalls");
	normalizeThinkingLevel(normalized);
	return normalized;
}

export function resolveTurnLimits(config: Config): EffectiveTurnLimits {
	return {
		observerMaxTurnsPerRun: config.observerMaxTurnsPerRun ?? DEFAULT_MAX_TURNS,
		reflectorMaxTurnsPerPass: config.reflectorMaxTurnsPerPass ?? config.compactionMaxToolCalls ?? DEFAULT_MAX_TURNS,
		prunerMaxTurnsPerPass: config.prunerMaxTurnsPerPass ?? config.compactionMaxToolCalls ?? DEFAULT_MAX_TURNS,
	};
}

export function readEnvConfig(env: NodeJS.ProcessEnv = process.env): Partial<Config> {
	const result: Partial<Config> = {};
	const rawPassive = env[PASSIVE_ENV];
	if (rawPassive !== undefined) {
		const passive = rawPassive.trim().toLowerCase();
		if (["1", "true", "yes", "on"].includes(passive)) result.passive = true;
		else if (["0", "false", "no", "off"].includes(passive)) result.passive = false;
	}
	const rawEnabled = env[ENABLED_ENV];
	if (rawEnabled !== undefined) {
		const enabled = rawEnabled.trim().toLowerCase();
		if (["1", "true", "yes", "on"].includes(enabled)) result.enabled = true;
		else if (["0", "false", "no", "off"].includes(enabled)) result.enabled = false;
	}
	return result;
}

function readNamespacedConfig(path: string): Partial<Config> {
	if (!existsSync(path)) return {};
	try {
		const raw = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
		const nested = raw[SETTINGS_KEY];
		return nested && typeof nested === "object" ? normalizeSettingsConfig(nested as Partial<Config>) : {};
	} catch {
		return {};
	}
}

export function loadConfig(cwd: string, env: NodeJS.ProcessEnv = process.env): Config {
	const globalPath = join(getAgentDir(), "settings.json");
	const projectPath = join(cwd, ".pi", "settings.json");

	return {
		...DEFAULTS,
		...readNamespacedConfig(globalPath),
		...readNamespacedConfig(projectPath),
		...readEnvConfig(env),
	};
}
