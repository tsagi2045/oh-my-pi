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
	 * back to the originating tmux/Zellij target and optionally highlights
	 * it once. `null` (or absent) disables the click callback — the
	 * notification is still shown.
	 */
	onClick?: NotificationFocusAction | null;
}

export type NotificationFocusKind = "tmux" | "zellij";

/**
 * Focus target captured at notification dispatch time.
 *
 * Carries two flavors of fields:
 *
 * 1. **Click-jump identifiers** (`session`, `window`, `pane`) — internal IDs
 *    fed to tmux / Zellij commands on click. The user never sees these.
 * 2. **Display strings** (`windowName`, `paneTitle`) — the human-readable
 *    labels the user sees in their multiplexer UI. Fire sites use these to
 *    compose the notification subtitle so the toast tells the user *where*
 *    the alert came from.
 *
 * `kind` selects the click-jump backend:
 *   - `"tmux"`   → `window` = `<session>:<window-index>`, `pane` = `%5`
 *   - `"zellij"` → `window` = stable `tab_id`, `pane` = `ZELLIJ_PANE_ID`
 *
 * `kind` is optional for backward compatibility; absent is treated as
 * `"tmux"` by the click handler.
 */
export interface NotificationFocusAction {
	kind?: NotificationFocusKind;
	session: string;
	window: string;
	pane: string;
	windowName: string;
	paneTitle: string;
	/**
	 * macOS application name of the outer terminal hosting this multiplexer
	 * client (e.g. `"Ghostty"`, `"iTerm"`). Set by the fire site from
	 * `TERMINAL.macAppName` just before dispatch; consumed by the click
	 * handler to drive `osascript -e 'tell application "<app>" to activate'`.
	 *
	 * Empty/undefined → click handler skips the `activate` step (the user's
	 * window stays where it is and the pane/tab jump still runs).
	 */
	terminalApp?: string;
}

// Backward-compatible alias for existing imports/tests.
export type TmuxFocusAction = NotificationFocusAction;

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
	 * When true on darwin AND `deliveryOverride` is not set,
	 * `sendDesktopNotification` emits the OSC sequence directly so the
	 * terminal's own bundle owns the notification — meaning macOS
	 * notification-style settings, Notification Center, and click-to-focus
	 * all flow through that terminal app instead of through the `alerter` /
	 * `terminal-notifier` shell-out fallback.
	 */
	readonly nativeMacosNotifications: boolean;
	/**
	 * Force a specific delivery mechanism on darwin, regardless of
	 * `nativeMacosNotifications`. Wired from the user's `notify.delivery`
	 * setting at boot.
	 *
	 *   - `"alerter"` — always shell out to `alerter` / `terminal-notifier`.
	 *     Click callback works (jumps tmux pane, flashes pane background).
	 *     Toast icon is the notifier's, not the terminal app's.
	 *   - `"osc"` — always emit OSC 9 / OSC 99 / Bell. Native terminal owns
	 *     the toast; OMP cannot observe clicks.
	 *   - `undefined` (default `"auto"`) — keep the native-vs-shell-out
	 *     decision driven by `nativeMacosNotifications`.
	 *
	 * Non-darwin platforms ignore this field entirely — they always emit OSC.
	 */
	deliveryOverride?: "alerter" | "osc";
}
