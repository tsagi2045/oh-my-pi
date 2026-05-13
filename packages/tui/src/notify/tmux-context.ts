import type { TmuxFocusAction } from "./types";

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
let cached: TmuxFocusAction | null | undefined;

export function getTmuxContext(): TmuxFocusAction | null {
	if (cached !== undefined) return cached;
	cached = resolveTmuxContext();
	return cached;
}

function resolveTmuxContext(): TmuxFocusAction | null {
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
		//   session_name | session:window_index | pane_id | window_name | pane_title
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
		// session/window/pane are required for click-jump to work; without
		// them we return null so the caller skips the click action entirely.
		// windowName/paneTitle are display-only — empty is acceptable.
		if (!session || !window || !paneId) return null;
		return { session, window, pane: paneId, windowName, paneTitle };
	} catch {
		// `tmux` not on PATH or some other spawn failure — gracefully degrade.
		return null;
	}
}

/**
 * Compose a human-readable subtitle string for desktop notifications from
 * the tmux context plus an optional fallback (e.g. the OMP session name set
 * via `/name`). Used by the completion + ask fire sites.
 *
 * Resolution order:
 *   1. `windowName · paneTitle` when both are set and non-equal — gives the
 *      user the most context (project + role).
 *   2. `windowName` or `paneTitle` alone when only one is non-empty.
 *   3. `fallback` (typically `sessionManager.getSessionName()`) when tmux is
 *      absent or both display labels are empty.
 *   4. `undefined` when nothing is available — the toast renders without a
 *      subtitle line, which both alerter and macOS notifications handle
 *      gracefully.
 */
export function composeNotificationSubtitle(tmux: TmuxFocusAction | null, fallback?: string): string | undefined {
	const fallbackTrimmed = fallback?.trim();
	if (tmux) {
		const w = tmux.windowName.trim();
		// The OMP-supplied `fallback` is the live `getSessionName()` value — it
		// always reflects the latest auto-name or manual rename, even when the
		// LLM-generated session title landed *after* the cached tmux
		// `pane_title` was captured. Prefer it over the (possibly stale)
		// `π: …` pane title; only fall back to the pane title when the OMP
		// name is empty (e.g. on the very first turn before any naming
		// happens). The `π:` prefix is OMP self-attribution — redundant
		// inside an OMP-fired desktop notification, so we strip it.
		const p = fallbackTrimmed || stripOmpTitlePrefix(tmux.paneTitle).trim();
		if (w && p && w !== p) return `${w} · ${p}`;
		if (w) return w;
		if (p) return p;
	}
	return fallbackTrimmed ? fallbackTrimmed : undefined;
}

/**
 * Strip OMP's own `π: ` (or `π:`) prefix from a tmux pane title.
 *
 * Kept tightly scoped — only the literal `π` glyph is removed, not arbitrary
 * single-char prefixes — so a pane title that legitimately starts with a
 * different non-ASCII char + colon (set by another tool) survives intact.
 */
function stripOmpTitlePrefix(value: string): string {
	return value.replace(/^π\s*:\s*/u, "");
}

/** Reset the cache. Test-only. */
export function resetTmuxContextForTesting(): void {
	cached = undefined;
}
