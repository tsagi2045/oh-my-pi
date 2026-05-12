import { $env } from "@oh-my-pi/pi-utils";
import { sendMacNotification } from "./mac";
import type { LegacyNotifier, NotificationOpts } from "./types";

/**
 * Public entry point for desktop notifications.
 *
 * Routes to the platform-specific implementation:
 *
 * - **darwin**: shells out to alerter / terminal-notifier / osascript via
 *   `notify/mac.ts`. Carries title, subtitle, body, group, and click-callback.
 * - **other**: writes an OSC 9 / OSC 99 / Bell escape sequence to stdout
 *   using the `LegacyNotifier`'s protocol-specific formatter (typically
 *   `TerminalInfo.formatNotification`). The single text field is built from
 *   `formatLegacyMessage(opts)`.
 *
 * Honors `PI_NOTIFICATIONS=off|0|false` as a global suppression switch.
 */
export function sendDesktopNotification(legacy: LegacyNotifier, opts: NotificationOpts): void {
	if (isNotificationSuppressed()) return;
	if (process.platform === "darwin") {
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
