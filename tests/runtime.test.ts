import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULTS } from "../src/config.js";
import { Runtime } from "../src/runtime.js";

const ENABLED_ENV = "PI_OBSERVATIONAL_MEMORY_ENABLED";

describe("Runtime.reloadConfig / getConfig", () => {
	const originalEnabled = process.env[ENABLED_ENV];

	beforeEach(() => {
		delete process.env[ENABLED_ENV];
	});

	afterEach(() => {
		if (originalEnabled === undefined) delete process.env[ENABLED_ENV];
		else process.env[ENABLED_ENV] = originalEnabled;
	});

	it("getConfig returns DEFAULTS before any load (always populated, never throws)", () => {
		const runtime = new Runtime();
		expect(runtime.getConfig()).toEqual(DEFAULTS);
		expect(runtime.getConfig().enabled).toBe(true);
	});

	it("ensureConfig loads + caches (configLoaded flips to true)", () => {
		const runtime = new Runtime();
		expect(runtime.configLoaded).toBe(false);
		runtime.ensureConfig(process.cwd());
		expect(runtime.configLoaded).toBe(true);
		expect(runtime.getConfig()).toEqual(runtime.config);
	});

	it("reloadConfig clears the cache + reloads from freshly-written env", () => {
		const runtime = new Runtime();
		const cwd = process.cwd();

		// initial load: enabled defaults true (no env)
		runtime.ensureConfig(cwd);
		expect(runtime.getConfig().enabled).toBe(true);

		// env flips enabled false → reloadConfig picks it up without a process restart
		process.env[ENABLED_ENV] = "0";
		runtime.reloadConfig(cwd);
		expect(runtime.configLoaded).toBe(true);
		expect(runtime.getConfig().enabled).toBe(false);

		// env flips back true → reloadConfig reflects it
		process.env[ENABLED_ENV] = "1";
		runtime.reloadConfig(cwd);
		expect(runtime.getConfig().enabled).toBe(true);
	});

	it("reloadConfig forces a fresh load even when the cache was already populated", () => {
		const runtime = new Runtime();
		const cwd = process.cwd();

		runtime.ensureConfig(cwd);
		const first = runtime.getConfig();
		expect(first.enabled).toBe(true);

		// Without reloadConfig, the cached config would stay true despite env change.
		process.env[ENABLED_ENV] = "0";
		expect(runtime.getConfig().enabled).toBe(true); // still cached

		runtime.reloadConfig(cwd);
		expect(runtime.getConfig().enabled).toBe(false); // cache invalidated + reloaded
	});
});
