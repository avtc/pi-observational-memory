import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import observationalMemory from "../src/index.js";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const ENABLED_ENV = "PI_OBSERVATIONAL_MEMORY_ENABLED";

/** Minimal fake pi capturing `on` handlers + a real events bus (on returns an
 *  unsub that actually removes; emit dispatches all listeners). */
function makeFakePi() {
	const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
	const reg = (event: string, handler: (...args: unknown[]) => void) => {
		const list = handlers.get(event) ?? [];
		list.push(handler);
		handlers.set(event, list);
	};
	const remove = (event: string, handler: (...args: unknown[]) => void) => {
		const list = handlers.get(event);
		if (list) {
			const idx = list.indexOf(handler);
			if (idx >= 0) list.splice(idx, 1);
		}
	};
	const pi = {
		on: vi.fn((event: string, handler: (...args: unknown[]) => void) => reg(event, handler)),
		registerCommand: vi.fn(),
		registerTool: vi.fn(),
		appendEntry: vi.fn(),
		events: {
			emit: vi.fn(),
			on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
				reg(event, handler);
				return () => remove(event, handler);
			}),
		},
	};
	return { pi, handlers };
}

function makeCtx(cwd: string): ExtensionContext {
	return { cwd } as unknown as ExtensionContext;
}

describe("observationalMemory :ready API (pi-observational-memory:ready)", () => {
	const originalEnabled = process.env[ENABLED_ENV];

	beforeEach(() => {
		delete process.env[ENABLED_ENV];
	});

	afterEach(() => {
		if (originalEnabled === undefined) delete process.env[ENABLED_ENV];
		else process.env[ENABLED_ENV] = originalEnabled;
	});

	it("does NOT emit :ready at activate time (deferred to session_start)", () => {
		const { pi } = makeFakePi();
		observationalMemory(pi as unknown as ExtensionAPI);
		expect(pi.events.emit).not.toHaveBeenCalled();
	});

	it("emits pi-observational-memory:ready on session_start with the api", () => {
		const { pi, handlers } = makeFakePi();
		observationalMemory(pi as unknown as ExtensionAPI);

		const startHandlers = handlers.get("session_start") ?? [];
		expect(startHandlers.length).toBe(1);
		startHandlers[0]!({ type: "session_start", reason: "startup" }, makeCtx("/tmp/arm-cwd"));

		expect(pi.events.emit).toHaveBeenCalledTimes(1);
		const [event, api] = pi.events.emit.mock.calls[0]!;
		expect(event).toBe("pi-observational-memory:ready");
		expect(api).toBeDefined();
		expect(typeof (api as { reloadConfig: unknown }).reloadConfig).toBe("function");
		expect(typeof (api as { getConfig: unknown }).getConfig).toBe("function");
	});

	it("api.getConfig returns the current effective config (enabled true by default)", () => {
		const { pi, handlers } = makeFakePi();
		observationalMemory(pi as unknown as ExtensionAPI);
		(handlers.get("session_start") ?? [])[0]!({ reason: "startup" }, makeCtx("/tmp/arm-cwd"));

		const api = pi.events.emit.mock.calls[0]![1] as { getConfig: () => { enabled: boolean } };
		expect(api.getConfig().enabled).toBe(true);
	});

	it("api.reloadConfig re-reads env (reflects a live PI_OBSERVATIONAL_MEMORY_ENABLED flip)", () => {
		const { pi, handlers } = makeFakePi();
		observationalMemory(pi as unknown as ExtensionAPI);
		(handlers.get("session_start") ?? [])[0]!({ reason: "startup" }, makeCtx("/tmp/arm-cwd"));

		const api = pi.events.emit.mock.calls[0]![1] as { getConfig: () => { enabled: boolean }; reloadConfig: (cwd?: string) => void };

		expect(api.getConfig().enabled).toBe(true);
		process.env[ENABLED_ENV] = "0";
		api.reloadConfig();
		expect(api.getConfig().enabled).toBe(false);
	});

	it("api.reloadConfig uses the session_start cwd when no override is passed", () => {
		const { pi, handlers } = makeFakePi();
		observationalMemory(pi as unknown as ExtensionAPI);
		(handlers.get("session_start") ?? [])[0]!({ reason: "startup" }, makeCtx("/tmp/session-cwd"));

		process.env[ENABLED_ENV] = "0";
		const api = pi.events.emit.mock.calls[0]![1] as { getConfig: () => { enabled: boolean }; reloadConfig: (cwd?: string) => void };
		// no cwd arg → uses the session_start-captured cwd, env still applies
		api.reloadConfig();
		expect(api.getConfig().enabled).toBe(false);
	});

	it("api.reloadConfig accepts an explicit cwd override", () => {
		const { pi, handlers } = makeFakePi();
		observationalMemory(pi as unknown as ExtensionAPI);
		(handlers.get("session_start") ?? [])[0]!({ reason: "startup" }, makeCtx("/tmp/session-cwd"));

		process.env[ENABLED_ENV] = "0";
		const api = pi.events.emit.mock.calls[0]![1] as { getConfig: () => { enabled: boolean }; reloadConfig: (cwd?: string) => void };
		api.reloadConfig("/tmp/explicit-override-cwd");
		expect(api.getConfig().enabled).toBe(false);
	});
});
