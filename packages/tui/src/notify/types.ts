/**
 * Public types for desktop notifications.
 *
 * The TUI ships notifications through three protocol families depending on
 * platform and what's installed:
 *
 * - **macOS**: `alerter` / `terminal-notifier` if available (rich title/body,
 *   click callback), else `osascript display notification` (no click).
 * - **Linux/other**: OSC 9 / OSC 99 / Bell escape sequences written to stdout,
 *   wrapped in tmux DCS passthrough when needed. No click support.
 *
 * Callers express intent through `NotificationOpts`; the platform layer maps
 * it to whatever the underlying mechanism supports and silently drops fields
 * the protocol can't represent (e.g. `subtitle` / `onClick` on OSC).
 */

export interface NotificationOpts {
	/** Bold first line. Required. */
	title: string;
	/** Optional second line above the body. macOS-only; ignored on OSC paths. */
	subtitle?: string;
	/** Main body text. Required. Newlines are preserved on macOS, flattened to spaces on OSC. */
	body: string;
	/**
	 * Replacement key. When two notifications share a `group`, the newer one
	 * replaces the older in the macOS Notification Center stack. Linux OSC
	 * paths ignore this. Convention: `omp-<event>-<sessionId>`.
	 */
	group?: string;
	/**
	 * Click action. When set and the platform supports callbacks (macOS with
	 * alerter/terminal-notifier installed), clicking the toast jumps focus
	 * back to the originating tmux pane and flashes its border. `null` (or
	 * absent) disables the click callback — the notification is still shown.
	 */
	onClick?: TmuxFocusAction | null;
}

/**
 * Tmux context captured at notification dispatch time via `getTmuxContext()`.
 * Carries two flavors of fields:
 *
 * 1. **Click-jump identifiers** (`session`, `window`, `pane`) — internal IDs
 *    fed to `tmux select-window` / `tmux select-pane` and the kitty-tab
 *    title match. The user never sees these.
 * 2. **Display strings** (`windowName`, `paneTitle`) — the human-readable
 *    labels the user sees in their tmux status line. Fire sites use these
 *    to compose the notification subtitle so the toast tells the user
 *    *where* the alert came from — useful when several OMP instances live
 *    in different windows of the same tmux session.
 *
 * Both flavors are populated in a single `tmux display-message` round-trip;
 * the display strings can be empty when tmux's `set -g pane-border-format`
 * (or equivalent) hasn't been customized.
 */
export interface TmuxFocusAction {
	/** tmux session display name, used to match the kitty tab title. */
	session: string;
	/** `<session>:<window-index>` form for `tmux select-window`. */
	window: string;
	/** Pane id (`%5`) for `tmux select-pane`. */
	pane: string;
	/** Human-readable tmux window name (`#{window_name}`). May be empty. */
	windowName: string;
	/** Human-readable tmux pane title (`#{pane_title}`). May be empty. */
	paneTitle: string;
}

/**
 * Minimal contract for the OSC 9 / OSC 99 / Bell fallback path.
 *
 * Implemented by `TerminalInfo`. We accept this as a parameter (rather than
 * importing `TerminalInfo` directly) to avoid a circular import between
 * `terminal-capabilities.ts` and `notify/desktop.ts` — the desktop module
 * doesn't need any of TerminalInfo's other state.
 */
export interface LegacyNotifier {
	formatNotification(message: string): string;
	/**
	 * True when the host terminal app surfaces its own notifications natively
	 * on macOS — i.e. it's a registered LSApplication with notification
	 * permission and handles OSC 9 / OSC 99 by calling
	 * `UNUserNotificationCenter`. Ghostty, iTerm2, and wezterm fit this
	 * description; kitty and alacritty do not (their OSC handlers exist but
	 * the app isn't a notification-capable bundle on macOS).
	 *
	 * When true on darwin, `sendDesktopNotification` emits the OSC sequence
	 * directly so the terminal's own bundle owns the notification — meaning
	 * macOS notification-style settings, Notification Center, and click-to-
	 * focus all flow through that terminal app instead of through the
	 * `alerter` / `terminal-notifier` shell-out fallback.
	 */
	readonly nativeMacosNotifications: boolean;
}
