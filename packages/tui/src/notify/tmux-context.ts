import { getZellijContext } from "./zellij-context";
import type { NotificationFocusAction } from "./types";

/**
 * Resolves the current tmux session/window/pane for click-jump callbacks.
 *
 * Lazy + cached: the resolution runs once on first call and the result (or
 * `null` for "not in tmux / lookup failed") is reused for the lifetime of
 * the process. Notifications fire many times per session; we don't want a
 * `tmux display-message` spawn on every alert.
 *
 * `null` means "no click callback should be attached" — the notification
 * still gets dispatched, just without `--execute`.
 */
let cached: NotificationFocusAction | null | undefined;

export function getTmuxContext(): NotificationFocusAction | null {
	if (cached !== undefined) return cached;
	cached = resolveTmuxContext();
	return cached;
}

export function getNotificationFocusContext(): NotificationFocusAction | null {
	return getZellijContext() ?? getTmuxContext();
}

function resolveTmuxContext(): NotificationFocusAction | null {
	const pane = process.env.TMUX_PANE;
	const tmuxEnv = process.env.TMUX;
	if (!pane || !tmuxEnv) return null;
	try {
		// Single round-trip: ask tmux for the click-jump identifiers AND the
		// human-readable display labels in one go. Newline-separated because
		// Bun rejects null bytes in spawn args; newline is safe — none of
		// these tmux variables can legitimately contain a `\n`.
		//
		// Five fields, fixed order:
		//   session_name              (used as the sessionName label + as the
		//                              `switch-client -t` target inside the
		//                              click handler so cross-session jumps
		//                              actually land in the right session)
		//   session_name:window_index (`select-window` target)
		//   pane_id                   (`select-pane` target)
		//   window_name               (display-only label)
		//   pane_title                (display-only label, π-prefix stripped
		//                              before showing to the user)
		const result = Bun.spawnSync(
			[
				"tmux",
				"display-message",
				"-p",
				"-t",
				pane,
				"#{session_name}\n#{session_name}:#{window_index}\n#{pane_id}\n#{window_name}\n#{pane_title}",
			],
			{ stdout: "pipe", stderr: "ignore" },
		);
		if (result.exitCode !== 0) return null;
		const out = new TextDecoder().decode(result.stdout).replace(/\n$/, "");
		const parts = out.split("\n");
		if (parts.length !== 5) return null;
		const [session, window, paneId, windowName, paneTitle] = parts as [string, string, string, string, string];
		if (!session || !window || !paneId) return null;
		return { kind: "tmux", session, window, pane: paneId, windowName, paneTitle };
	} catch {
		return null;
	}
}

/**
 * Compose the desktop notification subtitle from the multiplexer context plus
 * the **OMP session name** supplied by the caller (typically
 * `sessionManager.getSessionName()`).
 *
 * Output format:
 *
 *   `<windowName> · <OMPSessionName>`
 *
 * where the second half is the OMP session name (e.g.
 * `"Ghostty zellij 알림 설정"` — the LLM-generated or `/name`-set label the
 * user assigns to a chat session, NOT the multiplexer session name).
 *
 * This is what the user actually wants to see: tab/window name (project /
 * role) + the meaningful work label for this OMP run.
 *
 * Fallback chain (most specific → least specific):
 *   1. windowName + ompSessionName both set (and distinct) → `<windowName> · <ompSessionName>`
 *   2. windowName alone (no OMP session, e.g. before the first auto-name lands) → `<windowName>`
 *   3. ompSessionName alone (empty windowName) → `<ompSessionName>`
 *   4. multiplexer sessionName as a last resort → `<session>`
 *   5. nothing → `undefined`
 */
export function composeNotificationSubtitle(ctx: NotificationFocusAction | null, fallback?: string): string | undefined {
	const fallbackTrimmed = fallback?.trim();
	const ompSession = fallbackTrimmed || undefined;
	if (ctx) {
		const w = ctx.windowName.trim();
		if (w && ompSession && w !== ompSession) return `${w} · ${ompSession}`;
		if (w) return w;
		if (ompSession) return ompSession;
		const s = ctx.session.trim();
		if (s) return s;
		return undefined;
	}
	return ompSession;
}

/** Reset the cache. Test-only. */
export function resetTmuxContextForTesting(): void {
	cached = undefined;
}