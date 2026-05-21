import { $env } from "@oh-my-pi/pi-utils";
import { sendMacNotification } from "./mac";
import type { LegacyNotifier, NotificationOpts } from "./types";

/**
 * Public entry point for desktop notifications.
 *
 * Dispatch priority (in order):
 *
 * 1. **`legacy.deliveryOverride`** — user-controlled override from
 *    `notify.delivery`. Wins over all auto-detected paths on darwin.
 *      - `"alerter"` on darwin → `sendMacNotification` regardless of the
 *        terminal's native-notification capability.
 *      - `"osc"` on darwin → emit OSC 9 / OSC 99 / Bell regardless of the
 *        terminal app bundle.
 *    On non-darwin platforms the override is moot — they always emit OSC.
 * 2. **`opts.onClick` present on darwin** — the caller captured a click-jump
 *    target (tmux or Zellij), so we MUST use the shell notifier path even
 *    on native terminals like Ghostty. The native OSC path cannot carry
 *    click callbacks.
 * 3. **Native-on-darwin terminals (`nativeMacosNotifications = true`)** —
 *    ghostty, iTerm2, wezterm. Emit the OSC sequence and let the terminal
 *    app own everything when no click callback is needed.
 * 4. **Other darwin terminals (kitty, alacritty, vscode, plain shells)** —
 *    no notification-capable bundle, so shell out to `alerter` /
 *    `terminal-notifier` via `notify/mac.ts`.
 * 5. **Linux / Windows** — write the OSC 9 / OSC 99 / Bell escape sequence
 *    to stdout using the `LegacyNotifier`'s protocol-specific formatter.
 *
 * Each path carries title + subtitle + body. The OSC path collapses them to
 * a single string via `formatLegacyMessage`; the notifier path forwards the
 * structured `NotificationOpts` so it can render discrete fields.
 *
 * Honors `PI_NOTIFICATIONS=off|0|false` as a global suppression switch.
 */
export function sendDesktopNotification(legacy: LegacyNotifier, opts: NotificationOpts): void {
	if (isNotificationSuppressed()) return;
	if (process.platform === "darwin") {
		if (legacy.deliveryOverride === "alerter") {
			sendMacNotification(opts);
			return;
		}
		if (legacy.deliveryOverride === "osc") {
			process.stdout.write(legacy.formatNotification(formatLegacyMessage(opts)));
			return;
		}
		if (opts.onClick) {
			sendMacNotification(opts);
			return;
		}
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
