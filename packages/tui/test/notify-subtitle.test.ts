/**
 * `composeNotificationSubtitle` policy (v3, post-user feedback).
 *
 * The user wants the second half of the subtitle to carry the **OMP
 * session name** (the meaningful, per-run work label like
 * `"Ghostty tmux Oh-My-Posh 알림 설정"`), NOT the tmux session name
 * (which is just a workspace identifier shared across many OMP runs).
 *
 * Contract:
 *   `<windowName> · <ompSessionName>`
 *
 * with this fallback chain (most specific → least specific):
 *   1. windowName + ompSessionName both set (and distinct) → joined with ` · `
 *   2. windowName alone → `<windowName>`
 *   3. ompSessionName alone → `<ompSessionName>`
 *   4. tmux session name (last resort, broken tmux + no OMP fallback) → `<tmuxSessionName>`
 *   5. nothing usable → `undefined`
 *
 * v2 of this function emitted `<windowName> · <tmuxSessionName>`. v3
 * demotes tmux sessionName to a last-resort slot.
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

describe("composeNotificationSubtitle (windowName · OMP session)", () => {
	it("returns undefined when tmux is null and no fallback is given", () => {
		expect(composeNotificationSubtitle(null)).toBeUndefined();
	});

	it("returns the OMP session name verbatim when tmux is null but a fallback is provided", () => {
		expect(composeNotificationSubtitle(null, "오마이푸시 설정 인터뷰")).toBe("오마이푸시 설정 인터뷰");
	});

	it("returns undefined when fallback is whitespace-only", () => {
		// " " or "\t\n" must not surface as a visible empty subtitle line.
		expect(composeNotificationSubtitle(null, "   ")).toBeUndefined();
	});

	it("joins windowName and OMP session with ` · ` when both are set and distinct", () => {
		// Canonical case: tmux window labels the project / role ("experiment"),
		// OMP session carries the meaningful work label
		// ("Ghostty tmux Oh-My-Posh 알림 설정"). The tmux session name
		// ("3_sandbox") is deliberately NOT in the slot.
		expect(
			composeNotificationSubtitle(
				tmux({ windowName: "experiment", session: "3_sandbox" }),
				"Ghostty tmux Oh-My-Posh 알림 설정",
			),
		).toBe("experiment · Ghostty tmux Oh-My-Posh 알림 설정");
	});

	it("does NOT splice the tmux session name into the slot when an OMP session name is supplied", () => {
		// Sanity check: tmux session is just a workspace identifier; users see
		// it in their pane border / status line already. The notification
		// subtitle is supposed to surface the per-OMP-run label.
		const out = composeNotificationSubtitle(
			tmux({ windowName: "experiment", session: "3_sandbox" }),
			"오마이푸시 설정 인터뷰",
		);
		expect(out).not.toContain("3_sandbox");
		expect(out).toBe("experiment · 오마이푸시 설정 인터뷰");
	});

	it("returns windowName alone when OMP session is missing (first-turn case)", () => {
		// Before the first auto-name lands, sessionManager.getSessionName()
		// may return undefined / empty. The window name still has signal.
		expect(composeNotificationSubtitle(tmux({ windowName: "experiment", session: "3_sandbox" }))).toBe("experiment");
	});

	it("returns OMP session alone when windowName is empty", () => {
		// User in a freshly-spawned tmux window that hasn't been renamed yet:
		// the window name is the default ("zsh" or numeric). We don't want to
		// fall through to the tmux session — the OMP label is more useful.
		expect(composeNotificationSubtitle(tmux({ windowName: "", session: "3_sandbox" }), "오마이푸시 설정 인터뷰")).toBe(
			"오마이푸시 설정 인터뷰",
		);
	});

	it("trims surrounding whitespace before composing", () => {
		// `set-window-option -g pane-border-format` or shell title escapes
		// occasionally leave stray whitespace; collapse it before display.
		expect(
			composeNotificationSubtitle(tmux({ windowName: "  experiment  " }), "  오마이푸시 설정 인터뷰  "),
		).toBe("experiment · 오마이푸시 설정 인터뷰");
	});

	it("collapses to a single value when windowName and ompSession are identical", () => {
		// If a user names their tmux window after their OMP session (rare but
		// legal), rendering `foo · foo` is pure noise — emit one.
		expect(composeNotificationSubtitle(tmux({ windowName: "foo" }), "foo")).toBe("foo");
	});

	it("falls back to tmux sessionName ONLY when neither windowName nor OMP session is available", () => {
		// Defensive last resort. Should be exceedingly rare in practice
		// (would require: empty window name + no OMP session name + still
		// inside tmux).
		expect(composeNotificationSubtitle(tmux({ windowName: "", session: "3_sandbox" }))).toBe("3_sandbox");
	});

	it("returns undefined when tmux labels are all empty and no fallback", () => {
		expect(composeNotificationSubtitle(tmux({ windowName: "", session: "" }))).toBeUndefined();
	});

	it("prefers OMP session over tmux session in the last-resort slot too", () => {
		// Window name empty, both session sources present. OMP session wins.
		expect(composeNotificationSubtitle(tmux({ windowName: "", session: "3_sandbox" }), "오마이푸시 설정")).toBe(
			"오마이푸시 설정",
		);
	});
});
