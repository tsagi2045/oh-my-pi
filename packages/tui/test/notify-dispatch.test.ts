/**
 * `sendDesktopNotification` is the dispatch entry point that decides between
 * three paths:
 *
 *   1. OSC emit (native-on-darwin terminals + all non-darwin terminals)
 *   2. alerter / terminal-notifier shell-out (darwin + non-native terminal)
 *
 * The `nativeMacosNotifications` flag on the `LegacyNotifier` is what tips
 * dispatch between OSC and shell-out on macOS. These tests lock that
 * decision matrix.
 */
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { sendDesktopNotification } from "@oh-my-pi/pi-tui/notify/desktop";
import * as mac from "@oh-my-pi/pi-tui/notify/mac";
import type { LegacyNotifier, NotificationOpts } from "@oh-my-pi/pi-tui/notify/types";

const ORIGINAL_PLATFORM = process.platform;

function setPlatform(value: NodeJS.Platform): void {
	Object.defineProperty(process, "platform", { value, configurable: true });
}

function makeLegacy(nativeMacosNotifications: boolean, payload = "OSC-SEQ"): LegacyNotifier {
	// Stub LegacyNotifier — `formatNotification` returns a sentinel so we can
	// assert the OSC path wrote it verbatim to stdout. Real `TerminalInfo`
	// returns escape sequences; the dispatch doesn't care about the value.
	return {
		formatNotification: () => payload,
		nativeMacosNotifications,
	};
}

const opts: NotificationOpts = { title: "T", body: "B" };

describe("sendDesktopNotification dispatch", () => {
	let stdoutSpy: ReturnType<typeof spyOn>;
	let macSpy: ReturnType<typeof spyOn>;

	beforeEach(() => {
		stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
		macSpy = spyOn(mac, "sendMacNotification").mockImplementation(() => {});
	});

	afterEach(() => {
		setPlatform(ORIGINAL_PLATFORM);
		stdoutSpy.mockRestore();
		macSpy.mockRestore();
		// Clear suppression env so tests don't bleed.
		delete (Bun.env as Record<string, string | undefined>).PI_NOTIFICATIONS;
	});

	it("darwin + native terminal → emits OSC sequence, no shell-out", () => {
		setPlatform("darwin");
		sendDesktopNotification(makeLegacy(true, "OSC-NATIVE"), opts);
		expect(stdoutSpy).toHaveBeenCalledTimes(1);
		expect(stdoutSpy.mock.calls[0][0]).toBe("OSC-NATIVE");
		expect(macSpy).not.toHaveBeenCalled();
	});

	it("darwin + non-native terminal → shells out, no OSC", () => {
		setPlatform("darwin");
		sendDesktopNotification(makeLegacy(false), opts);
		expect(macSpy).toHaveBeenCalledTimes(1);
		expect(stdoutSpy).not.toHaveBeenCalled();
	});

	it("linux + native terminal → emits OSC (no platform check applies)", () => {
		setPlatform("linux");
		sendDesktopNotification(makeLegacy(true, "OSC-LINUX-NATIVE"), opts);
		expect(stdoutSpy).toHaveBeenCalledTimes(1);
		expect(stdoutSpy.mock.calls[0][0]).toBe("OSC-LINUX-NATIVE");
		expect(macSpy).not.toHaveBeenCalled();
	});

	it("linux + non-native terminal → emits OSC (Bell or otherwise — terminal owns the protocol)", () => {
		// `nativeMacosNotifications` is darwin-specific; on other platforms
		// it doesn't affect dispatch. The terminal's own `formatNotification`
		// already returns the right escape (Bell for Bell terminals).
		setPlatform("linux");
		sendDesktopNotification(makeLegacy(false, "BELL-OR-OSC"), opts);
		expect(stdoutSpy).toHaveBeenCalledTimes(1);
		expect(stdoutSpy.mock.calls[0][0]).toBe("BELL-OR-OSC");
		expect(macSpy).not.toHaveBeenCalled();
	});

	it("PI_NOTIFICATIONS=off short-circuits before any dispatch", () => {
		setPlatform("darwin");
		Bun.env.PI_NOTIFICATIONS = "off";
		sendDesktopNotification(makeLegacy(true), opts);
		sendDesktopNotification(makeLegacy(false), opts);
		expect(stdoutSpy).not.toHaveBeenCalled();
		expect(macSpy).not.toHaveBeenCalled();
	});
});
