import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
	subscribeToObservationalMemory,
	type ObservationalMemoryReadyApi,
} from "../../../src/snippets/canonical/subscribe-to-observational-memory.js";

/** Minimal fake pi: captures `on`/`events.on` listeners; `events.on` returns a
 *  real unsub (mirrors pi's shared eventBus); `fire` dispatches all listeners. */
interface FakePi {
	_handlers: Map<string, Array<(...args: unknown[]) => void>>;
	on(event: string, handler: (...args: unknown[]) => void): void;
	events: {
		on(event: string, handler: (...args: unknown[]) => void): () => void;
	};
}

function makeFakePi(): FakePi {
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
	return {
		_handlers: handlers,
		on: (event, handler) => reg(event, handler),
		events: {
			on: (event, handler) => {
				reg(event, handler);
				return () => remove(event, handler);
			},
		},
	};
}

function fire(pi: FakePi, event: string, ...args: unknown[]): void {
	for (const h of pi._handlers.get(event) ?? []) h(...args);
}

describe("subscribeToObservationalMemory (canonical snippet)", () => {
	it("returns safe defaults before :ready fires (OM absent)", () => {
		const pi = makeFakePi();
		const proxy = subscribeToObservationalMemory(pi as unknown as ExtensionAPI);
		expect(proxy.getConfig()).toBeNull();
		// no-op reloadConfig must not throw
		expect(() => proxy.reloadConfig()).not.toThrow();
		expect(() => proxy.reloadConfig("/tmp/x")).not.toThrow();
	});

	it("delegates to the api after pi-observational-memory:ready fires", () => {
		const pi = makeFakePi();
		const proxy = subscribeToObservationalMemory(pi as unknown as ExtensionAPI);
		const reloadConfig = vi.fn();
		const getConfig = vi.fn(() => ({ enabled: false }));
		const api: ObservationalMemoryReadyApi = { reloadConfig, getConfig };
		fire(pi, "pi-observational-memory:ready", api);

		proxy.reloadConfig("/tmp/arm-cwd");
		expect(reloadConfig).toHaveBeenCalledWith("/tmp/arm-cwd");

		expect(proxy.getConfig()).toEqual({ enabled: false });
		expect(getConfig).toHaveBeenCalledTimes(1);
	});

	it("reloadConfig with no args delegates undefined (the api supplies the session cwd default)", () => {
		const pi = makeFakePi();
		const proxy = subscribeToObservationalMemory(pi as unknown as ExtensionAPI);
		const reloadConfig = vi.fn();
		fire(pi, "pi-observational-memory:ready", { reloadConfig } as ObservationalMemoryReadyApi);

		proxy.reloadConfig();
		expect(reloadConfig).toHaveBeenCalledWith(undefined);
	});

	it("returns null from getConfig when the bridge is older (no getConfig method)", () => {
		const pi = makeFakePi();
		const proxy = subscribeToObservationalMemory(pi as unknown as ExtensionAPI);
		// older OM: has reloadConfig but NOT getConfig
		fire(pi, "pi-observational-memory:ready", { reloadConfig() {} });
		expect(proxy.getConfig()).toBeNull();
		// the older method still works
		expect(() => proxy.reloadConfig()).not.toThrow();
	});

	it("session_shutdown cleans the :ready listener (reload-safe)", () => {
		const pi = makeFakePi();
		subscribeToObservationalMemory(pi as unknown as ExtensionAPI);
		// before shutdown, both listeners are registered
		expect((pi._handlers.get("pi-observational-memory:ready") ?? []).length).toBe(1);
		expect((pi._handlers.get("session_shutdown") ?? []).length).toBe(1);
		fire(pi, "session_shutdown");
		// after shutdown, listeners are cleared
		expect((pi._handlers.get("pi-observational-memory:ready") ?? []).length).toBe(0);
	});
});
