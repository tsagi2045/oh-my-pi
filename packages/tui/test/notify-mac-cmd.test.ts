import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import {
	buildMacNotifierArgs,
	isAlerter,
	resetMacNotifierCacheForTesting,
	resetMissingNotifierWarnedForTesting,
	sendMacNotification,
} from "@oh-my-pi/pi-tui/notify/mac";
import { logger } from "@oh-my-pi/pi-utils";

const SCRIPT = "/abs/path/to/notify-click.sh";
const WRAPPER = "/abs/path/to/mac-alerter.sh";

describe("isAlerter", () => {
	it("matches the alerter binary by basename, not absolute path", () => {
		expect(isAlerter("/opt/homebrew/bin/alerter")).toBe(true);
		expect(isAlerter("alerter")).toBe(true);
		expect(isAlerter("/usr/local/bin/terminal-notifier")).toBe(false);
	});
});

describe("buildMacNotifierArgs (alerter)", () => {
	it("invokes the alerter wrapper script with positional args, not alerter directly", () => {
		// alerter has no `--execute` flag, so OMP shells out to the wrapper
		// `scripts/mac-alerter.sh` which handles the wait+click-route in a
		// detached subshell. The wrapper signature is:
		//   wrapper alerter title subtitle body group click session window pane
		const args = buildMacNotifierArgs("/opt/homebrew/bin/alerter", { title: "Done", body: "Hello" }, SCRIPT, WRAPPER);
		expect(args).toEqual([WRAPPER, "/opt/homebrew/bin/alerter", "Done", "", "Hello", "", "", "", "", ""]);
	});

	it("forwards subtitle and group to the wrapper as positional args", () => {
		const args = buildMacNotifierArgs(
			"/opt/homebrew/bin/alerter",
			{ title: "Task complete", subtitle: "my-session", body: "All done", group: "omp-stop-abc" },
			SCRIPT,
			WRAPPER,
		);
		expect(args).toEqual([
			WRAPPER,
			"/opt/homebrew/bin/alerter",
			"Task complete",
			"my-session",
			"All done",
			"omp-stop-abc",
			"",
			"",
			"",
			"",
		]);
	});

	it("forwards click action to the wrapper as click_script + session/window/pane", () => {
		// The wrapper, NOT TS, builds the alerter --actions flag and routes
		// the click to the script. So no shell quoting is needed here — the
		// values pass through Bun.spawn's argv array intact (incl. quotes,
		// spaces, and any other metacharacters).
		const args = buildMacNotifierArgs(
			"/opt/homebrew/bin/alerter",
			{
				title: "Task complete",
				body: "All done",
				onClick: { session: "my session", window: "my session:0", pane: "%5", windowName: "", paneTitle: "" },
			},
			SCRIPT,
			WRAPPER,
		);
		expect(args).toEqual([
			WRAPPER,
			"/opt/homebrew/bin/alerter",
			"Task complete",
			"",
			"All done",
			"",
			SCRIPT,
			"my session",
			"my session:0",
			"%5",
		]);
	});

	it("emits empty click_script when onClick is null/undefined so the wrapper skips --actions", () => {
		const args = buildMacNotifierArgs(
			"/opt/homebrew/bin/alerter",
			{ title: "Done", body: "Hello", onClick: null },
			SCRIPT,
			WRAPPER,
		);
		// Position 6 is `click_script`; empty means wrapper omits --actions.
		expect(args[6]).toBe("");
	});

	it("preserves embedded single quotes verbatim — no shell quoting on the alerter path", () => {
		const args = buildMacNotifierArgs(
			"/opt/homebrew/bin/alerter",
			{
				title: "x",
				body: "y",
				onClick: { session: "it's", window: "w", pane: "%1", windowName: "", paneTitle: "" },
			},
			SCRIPT,
			WRAPPER,
		);
		// Bun.spawn argv passes raw bytes; no `'\''` close-escape-reopen needed.
		expect(args[7]).toBe("it's");
	});
});

describe("buildMacNotifierArgs (terminal-notifier)", () => {
	it("uses BSD short-option flags and direct -execute", () => {
		const args = buildMacNotifierArgs("/usr/local/bin/terminal-notifier", { title: "Done", body: "Hello" }, SCRIPT);
		expect(args).toEqual([
			"/usr/local/bin/terminal-notifier",
			"-title",
			"Done",
			"-message",
			"Hello",
			"-sound",
			"default",
		]);
	});

	it("emits subtitle, group, and a shell-quoted -execute string when set", () => {
		const args = buildMacNotifierArgs(
			"/usr/local/bin/terminal-notifier",
			{
				title: "Task complete",
				subtitle: "my-session",
				body: "All done",
				group: "omp-stop-abc",
				onClick: { session: "my session", window: "my session:0", pane: "%5", windowName: "", paneTitle: "" },
			},
			SCRIPT,
		);
		const executeIdx = args.indexOf("-execute");
		expect(executeIdx).toBeGreaterThan(-1);
		// terminal-notifier hands the value to /bin/sh -c, so each component
		// must be shell-quoted.
		expect(args[executeIdx + 1]).toBe(`'${SCRIPT}' 'my session' 'my session:0' '%5'`);
	});

	it("omits -execute entirely when onClick is absent", () => {
		const args = buildMacNotifierArgs("/usr/local/bin/terminal-notifier", { title: "Done", body: "Hello" }, SCRIPT);
		expect(args).not.toContain("-execute");
	});
});

describe("sendMacNotification — no-notifier behavior", () => {
	let warnSpy: ReturnType<typeof spyOn> | undefined;
	let whichSpy: ReturnType<typeof spyOn> | undefined;

	beforeEach(() => {
		resetMacNotifierCacheForTesting();
		resetMissingNotifierWarnedForTesting();
	});

	afterEach(() => {
		warnSpy?.mockRestore();
		whichSpy?.mockRestore();
	});

	it("emits exactly one logger.warn on the first dispatch when no notifier is on PATH, then stays silent", () => {
		// Simulate `which alerter` + `which terminal-notifier` both returning
		// non-zero so `findMacNotifier` resolves to null. We can't actually
		// uninstall the user's alerter from inside a test, so we spy on the
		// spawnSync used by findMacNotifier.
		whichSpy = spyOn(Bun, "spawnSync").mockReturnValue({
			exitCode: 1,
			stdout: Buffer.alloc(0),
			stderr: Buffer.alloc(0),
			success: false,
			signalCode: null,
			resourceUsage: () => ({}) as never,
			pid: 0,
		} as unknown as ReturnType<typeof Bun.spawnSync>);
		warnSpy = spyOn(logger, "warn").mockImplementation(() => {});

		sendMacNotification({ title: "Task complete", body: "first" });
		sendMacNotification({ title: "Awaiting input", body: "second" });
		sendMacNotification({ title: "Plan ready", body: "third" });

		// Three dispatch attempts, exactly one warn. Subsequent dispatches
		// stay silent so the log doesn't drown in repeats.
		expect(warnSpy).toHaveBeenCalledTimes(1);
		const [msg, ctx] = warnSpy.mock.calls[0] ?? [];
		expect(typeof msg).toBe("string");
		expect(msg as string).toContain("alerter");
		expect(msg as string).toContain("brew install");
		// Title of the first dispatch is captured in context for forensics.
		expect(ctx).toEqual({ title: "Task complete" });
	});
});
