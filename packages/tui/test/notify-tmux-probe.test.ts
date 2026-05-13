/**
 * `parseTmuxEnvForOuterTerminal` reads `tmux show-environment -g` output and
 * decides which outer terminal started the tmux server. Used when
 * `TERM_PROGRAM=tmux` masks the real outer terminal — without this probe, OMP
 * would identify as "trueColor"/"base" and dispatch all notifications through
 * the alerter fallback instead of the terminal's native OSC handler.
 *
 * Order of checks (KITTY → GHOSTTY → WEZTERM → ITERM2 → ALACRITTY) is a
 * deliberate contract: when two markers happen to coexist (e.g. nested
 * terminal sessions), the first one wins.
 */
import { describe, expect, it } from "bun:test";
import { parseTmuxClientTermname, parseTmuxEnvForOuterTerminal } from "@oh-my-pi/pi-tui";

describe("parseTmuxEnvForOuterTerminal", () => {
	it("returns null on empty input", () => {
		expect(parseTmuxEnvForOuterTerminal("")).toBeNull();
	});

	it("returns null when no known marker is present", () => {
		const text = "PATH=/usr/bin\nHOME=/Users/x\nSHLVL=2\n";
		expect(parseTmuxEnvForOuterTerminal(text)).toBeNull();
	});

	it("identifies ghostty by GHOSTTY_RESOURCES_DIR", () => {
		const text =
			"PATH=/usr/bin\nGHOSTTY_RESOURCES_DIR=/Applications/Ghostty.app/Contents/Resources/ghostty\nHOME=/Users/x\n";
		expect(parseTmuxEnvForOuterTerminal(text)).toBe("ghostty");
	});

	it("identifies kitty by KITTY_WINDOW_ID", () => {
		const text = "KITTY_WINDOW_ID=1\nPATH=/usr/bin\n";
		expect(parseTmuxEnvForOuterTerminal(text)).toBe("kitty");
	});

	it("identifies wezterm by WEZTERM_PANE", () => {
		const text = "WEZTERM_PANE=0\nPATH=/usr/bin\n";
		expect(parseTmuxEnvForOuterTerminal(text)).toBe("wezterm");
	});

	it("identifies iterm2 by ITERM_SESSION_ID", () => {
		const text = "ITERM_SESSION_ID=w0t0p0:ABC-123\n";
		expect(parseTmuxEnvForOuterTerminal(text)).toBe("iterm2");
	});

	it("identifies alacritty by ALACRITTY_WINDOW_ID", () => {
		const text = "ALACRITTY_WINDOW_ID=12345\n";
		expect(parseTmuxEnvForOuterTerminal(text)).toBe("alacritty");
	});

	it("kitty takes precedence over ghostty when both are present (deterministic order)", () => {
		// Edge case: nested terminal where both markers survive. Order is the
		// contract — kitty first because it's earliest in env-driven detection.
		const text = "KITTY_WINDOW_ID=1\nGHOSTTY_RESOURCES_DIR=/x\n";
		expect(parseTmuxEnvForOuterTerminal(text)).toBe("kitty");
	});

	it("ignores `-KEY` lines (tmux's representation of unset)", () => {
		// `show-environment -g` prefixes unset entries with `-`. A `-GHOSTTY_RESOURCES_DIR`
		// line means the var was *removed*, not present, so we must NOT match.
		const text = "-GHOSTTY_RESOURCES_DIR\nPATH=/usr/bin\n";
		expect(parseTmuxEnvForOuterTerminal(text)).toBeNull();
	});

	it("does not match marker substrings inside other variable values", () => {
		// PATH containing the string `GHOSTTY_RESOURCES_DIR` must NOT trigger
		// a ghostty match — only literal `^KEY=` is a real marker.
		const text = "PATH=/opt/GHOSTTY_RESOURCES_DIR/bin:/usr/bin\nHOME=/Users/x\n";
		expect(parseTmuxEnvForOuterTerminal(text)).toBeNull();
	});

	it("does not match a marker key appearing only as a value", () => {
		const text = "OMP_INSPECT=KITTY_WINDOW_ID=abc\n";
		expect(parseTmuxEnvForOuterTerminal(text)).toBeNull();
	});
});

describe("parseTmuxClientTermname", () => {
	// `tmux list-clients -F '#{client_termname}'` returns the TERM value of
	// the currently-attached terminal. This is the authoritative source for
	// "which terminal is OMP's OSC output reaching right now" — more reliable
	// than the env-var probe which can be stale across server-vs-client
	// terminal mismatches (e.g. tmux server started from kitty, user later
	// detached and reattached from ghostty).

	it("returns null for empty / undefined input", () => {
		expect(parseTmuxClientTermname(undefined)).toBeNull();
		expect(parseTmuxClientTermname("")).toBeNull();
	});

	it("returns null for generic / unknown termnames", () => {
		// `tmux-256color`, `xterm-256color`, `screen` don't identify a known
		// terminal — return null so the caller can fall through to env-var
		// probe.
		expect(parseTmuxClientTermname("tmux-256color")).toBeNull();
		expect(parseTmuxClientTermname("xterm-256color")).toBeNull();
		expect(parseTmuxClientTermname("screen")).toBeNull();
		expect(parseTmuxClientTermname("dumb")).toBeNull();
	});

	it("identifies ghostty by `xterm-ghostty` (real-world value)", () => {
		expect(parseTmuxClientTermname("xterm-ghostty")).toBe("ghostty");
	});

	it("identifies kitty by `xterm-kitty` (real-world value)", () => {
		expect(parseTmuxClientTermname("xterm-kitty")).toBe("kitty");
	});

	it("identifies wezterm / iterm2 / alacritty by substring", () => {
		expect(parseTmuxClientTermname("wezterm")).toBe("wezterm");
		expect(parseTmuxClientTermname("iterm2")).toBe("iterm2");
		expect(parseTmuxClientTermname("xterm-iterm")).toBe("iterm2");
		expect(parseTmuxClientTermname("alacritty")).toBe("alacritty");
	});

	it("is case-insensitive", () => {
		expect(parseTmuxClientTermname("XTERM-GHOSTTY")).toBe("ghostty");
		expect(parseTmuxClientTermname("Kitty")).toBe("kitty");
	});
});
