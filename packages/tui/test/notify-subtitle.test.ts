/**
 * `composeNotificationSubtitle` is the policy that decides which identifier
 * the user sees in the notification toast subtitle. It picks tmux display
 * labels first (most specific), an OMP session-name fallback when tmux is
 * absent, and `undefined` when nothing is available. Locking the contract
 * here prevents the "OMP excerpt demo" hardcoded-subtitle regression we hit
 * mid-port.
 */
import { describe, expect, it } from "bun:test";
import { composeNotificationSubtitle, type TmuxFocusAction } from "@oh-my-pi/pi-tui";

function tmux(overrides: Partial<TmuxFocusAction> = {}): TmuxFocusAction {
	return {
		session: "tmux-sess",
		window: "tmux-sess:0",
		pane: "%1",
		windowName: "",
		paneTitle: "",
		...overrides,
	};
}

describe("composeNotificationSubtitle", () => {
	it("returns undefined when tmux is null and no fallback is given", () => {
		expect(composeNotificationSubtitle(null)).toBeUndefined();
	});

	it("returns the OMP session name when tmux is null but a fallback is provided", () => {
		expect(composeNotificationSubtitle(null, "my-session")).toBe("my-session");
	});

	it("returns undefined when fallback is whitespace-only", () => {
		// We don't want " " or "\t\n" rendering as a visible empty subtitle line.
		expect(composeNotificationSubtitle(null, "   ")).toBeUndefined();
	});

	it("returns windowName when only windowName is set", () => {
		expect(composeNotificationSubtitle(tmux({ windowName: "oh-my-pi" }))).toBe("oh-my-pi");
	});

	it("returns paneTitle when only paneTitle is set", () => {
		expect(composeNotificationSubtitle(tmux({ paneTitle: "kitty & tmux" }))).toBe("kitty & tmux");
	});

	it("joins windowName and paneTitle with `·` when both are set and distinct", () => {
		// User's actual setup: window labels the project, pane labels the role.
		expect(composeNotificationSubtitle(tmux({ windowName: "oh-my-pi", paneTitle: "kitty & tmux" }))).toBe(
			"oh-my-pi · kitty & tmux",
		);
	});

	it("collapses to a single value when windowName and paneTitle are identical", () => {
		// Default tmux behavior: pane_title mirrors window_name. Showing both
		// produces "oh-my-pi · oh-my-pi" which adds noise without info.
		expect(composeNotificationSubtitle(tmux({ windowName: "oh-my-pi", paneTitle: "oh-my-pi" }))).toBe("oh-my-pi");
	});

	it("ignores leading/trailing whitespace in tmux labels", () => {
		// pane_title commonly carries the shell's `\033]0;...\007` set-title
		// sequence which leaves stray whitespace on some shells.
		expect(composeNotificationSubtitle(tmux({ windowName: "  oh-my-pi  ", paneTitle: "" }))).toBe("oh-my-pi");
	});

	it("prefers the OMP fallback over a tmux paneTitle for the pane slot", () => {
		// User's actual complaint: title-generator caches paneTitle once per
		// process. When the LLM-driven auto-name lands later (or the user runs
		// /name mid-session), the cached `π: kitty & tmux` paneTitle no longer
		// matches the live `sessionManager.getSessionName()`. The composer
		// MUST surface the live fallback so the notification shows the actual
		// session identity. windowName keeps its slot.
		expect(
			composeNotificationSubtitle(tmux({ windowName: "bun", paneTitle: "π: kitty & tmux" }), "learning-omp-setting"),
		).toBe("bun · learning-omp-setting");
	});

	it("falls back to paneTitle when no OMP session name is supplied", () => {
		// First-turn case before auto-naming runs. The pane title is still
		// the best identifier we have.
		expect(composeNotificationSubtitle(tmux({ windowName: "bun", paneTitle: "kitty & tmux" }))).toBe(
			"bun · kitty & tmux",
		);
	});

	it("falls back to OMP session name when tmux labels are empty", () => {
		expect(composeNotificationSubtitle(tmux({}), "session-display-name")).toBe("session-display-name");
	});

	it("collapses to a single value when fallback and windowName are identical", () => {
		// Avoids "oh-my-pi · oh-my-pi" when the tmux window happens to be
		// named after the same session.
		expect(composeNotificationSubtitle(tmux({ windowName: "oh-my-pi" }), "oh-my-pi")).toBe("oh-my-pi");
	});
});

describe("composeNotificationSubtitle — π self-prefix stripping", () => {
	it("strips OMP's `π: ` prefix from paneTitle so the toast doesn't attribute OMP twice", () => {
		// title-generator.ts writes the OSC 0 terminal title as `π: <label>`,
		// which tmux mirrors into pane_title. The leading `π` is OMP's own
		// self-attribution and is redundant inside an OMP notification.
		expect(composeNotificationSubtitle(tmux({ windowName: "oh-my-pi", paneTitle: "π: kitty & tmux" }))).toBe(
			"oh-my-pi · kitty & tmux",
		);
	});

	it("strips a tightly-spaced `π:` (no space after colon) too", () => {
		expect(composeNotificationSubtitle(tmux({ windowName: "w", paneTitle: "π:foo" }))).toBe("w · foo");
	});

	it("does NOT strip non-π prefixes that look similar", () => {
		// A user's external tool legitimately setting "📁: project" should
		// survive untouched; only OMP's own glyph is treated as redundant.
		expect(composeNotificationSubtitle(tmux({ windowName: "w", paneTitle: "📁: project" }))).toBe("w · 📁: project");
	});

	it("falls back to windowName when stripping leaves an empty pane title", () => {
		// `π:` alone (no payload) collapses to empty after stripping; the
		// composer must skip the empty pane half rather than emit `w · `.
		expect(composeNotificationSubtitle(tmux({ windowName: "oh-my-pi", paneTitle: "π:" }))).toBe("oh-my-pi");
	});
});
