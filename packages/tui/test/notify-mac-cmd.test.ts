import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import {
	buildClickCommand,
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
		//   wrapper alerter title subtitle body group click terminal_app session window pane multiplexer
		const args = buildMacNotifierArgs("/opt/homebrew/bin/alerter", { title: "Done", body: "Hello" }, SCRIPT, WRAPPER);
		expect(args).toEqual([
			WRAPPER,
			"/opt/homebrew/bin/alerter",
			"Done",
			"",
			"Hello",
			"",
			"",
			"",
			"",
			"",
			"",
			"tmux",
		]);
	});

	it("forwards subtitle and group to the wrapper as positional args", () => {
		const args = buildMacNotifierArgs(
			"/opt/homebrew/bin/alerter",
			{ title: "Task complete", subtitle: "main:2.1 · oh-my-pi", body: "All done", group: "omp-stop-abc" },
			SCRIPT,
			WRAPPER,
		);
		expect(args).toEqual([
			WRAPPER,
			"/opt/homebrew/bin/alerter",
			"Task complete",
			"main:2.1 · oh-my-pi",
			"All done",
			"omp-stop-abc",
			"",
			"",
			"",
			"",
			"",
			"tmux",
		]);
	});

	it("forwards click action to the wrapper as click_script + terminal_app + session/window/pane", () => {
		// The wrapper, NOT TS, builds the alerter --actions flag and routes
		// the click to the script. So no shell quoting is needed here — the
		// values pass through Bun.spawn's argv array intact (incl. quotes,
		// spaces, and any other metacharacters).
		const args = buildMacNotifierArgs(
			"/opt/homebrew/bin/alerter",
			{
				title: "Task complete",
				body: "All done",
				onClick: {
					session: "my session",
					window: "my session:0",
					pane: "%5",
					windowName: "",
					paneTitle: "",
					terminalApp: "Ghostty",
				},
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
			"Ghostty",
			"my session",
			"my session:0",
			"%5",
			"tmux",
		]);
	});

	it("forwards zellij click action with explicit multiplexer kind", () => {
		const args = buildMacNotifierArgs(
			"/opt/homebrew/bin/alerter",
			{
				title: "Task complete",
				body: "All done",
				onClick: {
					kind: "zellij",
					session: "main",
					window: "7",
					pane: "5",
					windowName: "omp",
					paneTitle: "π: omp",
					terminalApp: "Ghostty",
				},
			},
			SCRIPT,
			WRAPPER,
		);
		expect(args.slice(-5)).toEqual(["Ghostty", "main", "7", "5", "zellij"]);
	});

	it("emits empty click_script and empty terminal_app when onClick is null/undefined", () => {
		const args = buildMacNotifierArgs(
			"/opt/homebrew/bin/alerter",
			{ title: "Done", body: "Hello", onClick: null },
			SCRIPT,
			WRAPPER,
		);
		// Position 6 is `click_script`, 7 is `terminal_app`; both empty means
		// the wrapper's click handler no-ops.
		expect(args[6]).toBe("");
		expect(args[7]).toBe("");
		expect(args[11]).toBe("tmux");
	});

	it("emits empty terminal_app when onClick is set but terminalApp is missing (no app to activate)", () => {
		// Fire site doesn't have `TERMINAL.macAppName` (e.g. base / trueColor
		// terminal). Click still routes pane-jump; just skips the
		// `osascript ... activate` step.
		const args = buildMacNotifierArgs(
			"/opt/homebrew/bin/alerter",
			{
				title: "x",
				body: "y",
				onClick: {
					session: "s",
					window: "s:0",
					pane: "%1",
					windowName: "",
					paneTitle: "",
				},
			},
			SCRIPT,
			WRAPPER,
		);
		expect(args[6]).toBe(SCRIPT);
		expect(args[7]).toBe("");
		expect(args[8]).toBe("s");
		expect(args[11]).toBe("tmux");
	});

	it("preserves embedded single quotes verbatim — no shell quoting on the alerter path", () => {
		const args = buildMacNotifierArgs(
			"/opt/homebrew/bin/alerter",
			{
				title: "x",
				body: "y",
				onClick: {
					session: "it's",
					window: "w",
					pane: "%1",
					windowName: "",
					paneTitle: "",
					terminalApp: "Ghostty",
				},
			},
			SCRIPT,
			WRAPPER,
		);
		// Bun.spawn argv passes raw bytes; no `'\''` close-escape-reopen needed.
		expect(args[8]).toBe("it's");
	});
});

describe("mac-alerter.sh wrapper script shape", () => {
	// These assertions lock the alerter argv produced *inside* the wrapper script
	// (which is what actually surfaces the notification). The TS arg-builder just
	// hands positional values to the wrapper; the script decides how they map to
	// alerter flags. Two invariants matter:
	//
	//   1. NO `--actions` on the base ARGS. With `--actions`, alerter forces
	//      Alert-style (persistent on screen, has to be clicked away). OMP's
	//      desired UX is Banner-style: auto-dismiss after ~5 s and let macOS
	//      archive the entry to Notification Center.
	//   2. NO non-zero `--timeout`. alerter calls `removeDeliveredNotification`
	//      when the timeout expires, which purges the NC entry too.
	const wrapperPath = path.resolve(import.meta.dir, "..", "scripts", "mac-alerter.sh");
	const source = readFileSync(wrapperPath, "utf8");
	const baseArgs = source.match(/^ARGS=\([^)]*\)/m)?.[0];

	it("does NOT pass --actions on the base ARGS (Banner mode lets macOS auto-dismiss)", () => {
		expect(baseArgs).toBeDefined();
		expect(baseArgs).not.toContain("--actions");
	});

	it("does NOT set a positive --timeout (alerter would remove the entry from NC)", () => {
		expect(source).not.toMatch(/--timeout\s+[1-9]/);
	});

	it("still routes @CONTENTCLICKED through the click handler", () => {
		expect(source).toContain("@CONTENTCLICKED");
	});

	it("invokes the click handler with terminal_app first, then session/window/pane/multiplexer", () => {
		expect(source).toMatch(/"\$CLICK_SCRIPT"\s+"\$TERMINAL_APP"\s+"\$SESSION"\s+"\$WIN"\s+"\$PANE"\s+"\$MULTIPLEXER"/);
	});
});

describe("notify-click.sh script shape", () => {
	// The Ghostty tab-selection AppleScript MUST run for both tmux and zellij
	// branches because each Ghostty tab hosts a separate multiplexer session.
	// A previous revision gated this step on `MULTIPLEXER != "zellij"`, which
	// broke Cmd+1/Cmd+2-style outer-tab switching for zellij users.
	const clickPath = path.resolve(import.meta.dir, "..", "scripts", "notify-click.sh");
	const source = readFileSync(clickPath, "utf8");

	it("runs the Ghostty AppleScript tab selector regardless of multiplexer", () => {
		// The guard line must NOT exclude zellij. We check the specific
		// expression that previously caused the regression.
		expect(source).not.toMatch(/MULTIPLEXER[^=]*!=\s*"zellij".*TERMINAL_APP[^=]*=\s*"Ghostty"/);
		// And the AppleScript block is still present.
		expect(source).toMatch(/tell application "Ghostty"/);
	});

	it("dispatches the zellij branch with --session targeting", () => {
		// Each pane/tab focus call must thread `--session "$SESSION"` so the
		// click handler reaches the correct background zellij instance.
		expect(source).toMatch(/\$ZELLIJ_BIN" --session "\$SESSION" action go-to-tab-by-id "\$WIN"/);
		expect(source).toMatch(/\$ZELLIJ_BIN" --session "\$SESSION" action focus-pane-id "\$PANE"/);
	});

	it("defaults to a single bright zellij flash", () => {
		// The previous gray (#303446) was nearly invisible on catppuccin-mocha
		// and a double-flash felt too noisy. Default is one yellow (#f9e2af)
		// flash, overridable via OMP_* env vars (e.g. OMP_PANE_BLINK_COUNT=2).
		expect(source).toMatch(/OMP_PANE_BLINK_COUNT:-1/);
		expect(source).toMatch(/OMP_ZELLIJ_PANE_BLINK_BG:-#f9e2af/);
		expect(source).toMatch(/OMP_PANE_BLINK_ON_SECONDS:-0\.35/);
		expect(source).toMatch(/OMP_PANE_BLINK_OFF_SECONDS:-0\.18/);
	});

	it("preserves legacy single-hold behavior when OMP_PANE_BLINK_HOLD_SECONDS is set", () => {
		// Anyone with a prior config that used the old single-hold variable
		// should keep getting one flash, not two.
		expect(source).toMatch(/OMP_PANE_BLINK_HOLD_SECONDS:-/);
		expect(source).toMatch(/BLINK_COUNT=1/);
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

	it("emits subtitle, group, and a shell-quoted -execute string when set (terminal_app slot included)", () => {
		const args = buildMacNotifierArgs(
			"/usr/local/bin/terminal-notifier",
			{
				title: "Task complete",
				subtitle: "main:2.1 · oh-my-pi",
				body: "All done",
				group: "omp-stop-abc",
				onClick: {
					session: "my session",
					window: "my session:0",
					pane: "%5",
					windowName: "",
					paneTitle: "",
					terminalApp: "Ghostty",
				},
			},
			SCRIPT,
		);
		const executeIdx = args.indexOf("-execute");
		expect(executeIdx).toBeGreaterThan(-1);
		// terminal-notifier hands the value to /bin/sh -c, so each component
		// must be shell-quoted. Order matches the notify-click.sh signature:
		//   scriptPath terminal_app session window pane multiplexer
		expect(args[executeIdx + 1]).toBe(`'${SCRIPT}' 'Ghostty' 'my session' 'my session:0' '%5' 'tmux'`);
	});

	it("omits -execute entirely when onClick is absent", () => {
		const args = buildMacNotifierArgs("/usr/local/bin/terminal-notifier", { title: "Done", body: "Hello" }, SCRIPT);
		expect(args).not.toContain("-execute");
	});
});

describe("buildClickCommand", () => {
	it("emits empty-string terminal_app slot when terminalApp is undefined (skips osascript activate)", () => {
		// Click handler treats empty terminal_app as \"don't run osascript\";
		// the tmux pane jump still runs.
		const cmd = buildClickCommand(SCRIPT, {
			session: "s",
			window: "s:0",
			pane: "%1",
			windowName: "",
			paneTitle: "",
		});
		expect(cmd).toBe(`'${SCRIPT}' '' 's' 's:0' '%1' 'tmux'`);
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
		sendMacNotification({ title: "Awaiting input", body: "third" });

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
