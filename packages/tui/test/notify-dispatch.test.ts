/**
 * `sendDesktopNotification` is the dispatch entry point that decides between
 * three paths on darwin:
 *
 *   1. `deliveryOverride === "alerter"` → always shell out, ignore native flag.
 *   2. `deliveryOverride === "osc"` → always OSC, ignore native flag.
 *   3. no override → native-vs-shell-out driven by `nativeMacosNotifications`.
 *
 * On non-darwin platforms the override is moot — OSC is always emitted.
 * These tests lock that decision matrix.
 */
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { sendDesktopNotification } from "@oh-my-pi/pi-tui/notify/desktop";
import * as mac from "@oh-my-pi/pi-tui/notify/mac";
import type { LegacyNotifier, NotificationOpts } from "@oh-my-pi/pi-tui/notify/types";

const ORIGINAL_PLATFORM = process.platform;

function setPlatform(value: NodeJS.Platform): void {
	Object.defineProperty(process, "platform", { value, configurable: true });
}

function makeLegacy(
	nativeMacosNotifications: boolean,
	payload = "OSC-SEQ",
	deliveryOverride?: "alerter" | "osc",
): LegacyNotifier {
	// Stub LegacyNotifier — `formatNotification` returns a sentinel so we can
	// assert the OSC path wrote it verbatim to stdout. Real `TerminalInfo`
	// returns escape sequences; the dispatch doesn't care about the value.
	return {
		formatNotification: () => payload,
		nativeMacosNotifications,
		deliveryOverride,
	};
}

const opts: NotificationOpts = { title: "T", body: "B" };
const optsWithClick: NotificationOpts = {
	title: "T",
	body: "B",
	onClick: {
		kind: "zellij",
		session: "main",
		window: "7",
		pane: "5",
		windowName: "omp",
		paneTitle: "π: omp",
		terminalApp: "Ghostty",
	},
};

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

	it("darwin + native terminal + no click target → emits OSC sequence, no shell-out", () => {
		setPlatform("darwin");
		sendDesktopNotification(makeLegacy(true, "OSC-NATIVE"), opts);
		expect(stdoutSpy).toHaveBeenCalledTimes(1);
		expect(stdoutSpy.mock.calls[0][0]).toBe("OSC-NATIVE");
		expect(macSpy).not.toHaveBeenCalled();
	});

	it("darwin + native terminal + click target → shells out so click callback can work", () => {
		setPlatform("darwin");
		sendDesktopNotification(makeLegacy(true, "OSC-NATIVE"), optsWithClick);
		expect(macSpy).toHaveBeenCalledTimes(1);
		expect(macSpy.mock.calls[0]?.[0]).toEqual(optsWithClick);
		expect(stdoutSpy).not.toHaveBeenCalled();
	});

	it("darwin + non-native terminal → shells out, no OSC", () => {
		setPlatform("darwin");
		sendDesktopNotification(makeLegacy(false), opts);
		expect(macSpy).toHaveBeenCalledTimes(1);
		expect(stdoutSpy).not.toHaveBeenCalled();
	});

	it("darwin + deliveryOverride='alerter' on a native terminal → forces shell-out", () => {
		setPlatform("darwin");
		sendDesktopNotification(makeLegacy(true, "OSC-NATIVE", "alerter"), opts);
		expect(macSpy).toHaveBeenCalledTimes(1);
		expect(stdoutSpy).not.toHaveBeenCalled();
	});

	it("darwin + deliveryOverride='osc' on a click-target notification → still forces OSC", () => {
		setPlatform("darwin");
		sendDesktopNotification(makeLegacy(true, "OSC-FORCED", "osc"), optsWithClick);
		expect(stdoutSpy).toHaveBeenCalledTimes(1);
		expect(stdoutSpy.mock.calls[0][0]).toBe("OSC-FORCED");
		expect(macSpy).not.toHaveBeenCalled();
	});

	it("darwin + deliveryOverride='osc' on a non-native terminal → forces OSC", () => {
		setPlatform("darwin");
		sendDesktopNotification(makeLegacy(false, "OSC-FORCED", "osc"), opts);
		expect(stdoutSpy).toHaveBeenCalledTimes(1);
		expect(stdoutSpy.mock.calls[0][0]).toBe("OSC-FORCED");
		expect(macSpy).not.toHaveBeenCalled();
	});

	it("linux + native terminal → emits OSC (override is darwin-only on the alerter branch)", () => {
		setPlatform("linux");
		sendDesktopNotification(makeLegacy(true, "OSC-LINUX-NATIVE", "alerter"), opts);
		expect(stdoutSpy).toHaveBeenCalledTimes(1);
		expect(stdoutSpy.mock.calls[0][0]).toBe("OSC-LINUX-NATIVE");
		expect(macSpy).not.toHaveBeenCalled();
	});

	it("linux + non-native terminal → emits OSC (Bell or otherwise — terminal owns the protocol)", () => {
		setPlatform("linux");
		sendDesktopNotification(makeLegacy(false, "BELL-OR-OSC"), opts);
		expect(stdoutSpy).toHaveBeenCalledTimes(1);
		expect(stdoutSpy.mock.calls[0][0]).toBe("BELL-OR-OSC");
		expect(macSpy).not.toHaveBeenCalled();
	});

	it("PI_NOTIFICATIONS=off short-circuits before any dispatch (including overrides)", () => {
		setPlatform("darwin");
		Bun.env.PI_NOTIFICATIONS = "off";
		sendDesktopNotification(makeLegacy(true), opts);
		sendDesktopNotification(makeLegacy(false), opts);
		sendDesktopNotification(makeLegacy(true, "x", "alerter"), opts);
		sendDesktopNotification(makeLegacy(false, "x", "osc"), opts);
		expect(stdoutSpy).not.toHaveBeenCalled();
		expect(macSpy).not.toHaveBeenCalled();
	});
});
