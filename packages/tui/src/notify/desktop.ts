import { $env } from "@oh-my-pi/pi-utils";
import { sendMacNotification } from "./mac";
import type { LegacyNotifier, NotificationOpts } from "./types";

/**
 * Public entry point for desktop notifications.
 *
 * Dispatch priority (in order):
 *
 * 1. **Native-on-darwin terminals (`nativeMacosNotifications = true`)** —
 *    ghostty, iTerm2, wezterm. These register their own `LSApplication` on
 *    macOS and surface OSC 9 / OSC 99 directly through
 *    `UNUserNotificationCenter`. Emit the OSC sequence and let the terminal
 *    own everything (notification style, NC archival, click-to-focus).
 * 2. **Other darwin terminals (kitty, alacritty, vscode, plain shells)** —
 *    no notification-capable bundle, so shell out to `alerter` /
 *    `terminal-notifier` via `notify/mac.ts`.
 * 3. **Linux / Windows** — write the OSC 9 / OSC 99 / Bell escape sequence
 *    to stdout using the `LegacyNotifier`'s protocol-specific formatter.
 *
 * Each path carries title + subtitle + body. The OSC path collapses them to
 * a single string via `formatLegacyMessage`; the alerter path forwards the
 * structured `NotificationOpts` so it can render discrete fields.
 *
 * Honors `PI_NOTIFICATIONS=off|0|false` as a global suppression switch.
 */
export function sendDesktopNotification(legacy: LegacyNotifier, opts: NotificationOpts): void {
	if (isNotificationSuppressed()) return;
	if (process.platform === "darwin") {
		if (legacy.nativeMacosNotifications) {
			process.stdout.write(legacy.formatNotification(formatLegacyMessage(opts)));
			return;
		}
		sendMacNotification(opts);
		return;
	}
	process.stdout.write(legacy.formatNotification(formatLegacyMessage(opts)));
}

export function isNotificationSuppressed(): boolean {
	const value = $env.PI_NOTIFICATIONS;
	if (!value) return false;
	return value === "off" || value === "0" || value === "false";
}

/**
 * Render `opts` as a single-line string for legacy OSC 9 / OSC 99 paths,
 * which carry only one text field. Subtitle (if any) is folded with `—`,
 * body is appended after `: `, and newlines collapse to spaces so the
 * escape sequence stays on one line as the protocol expects.
 */
export function formatLegacyMessage(opts: NotificationOpts): string {
	const heading = opts.subtitle ? `${opts.title} — ${opts.subtitle}` : opts.title;
	const body = opts.body.replaceAll(/\s*\n+\s*/gu, " ").trim();
	return body ? `${heading}: ${body}` : heading;
}
