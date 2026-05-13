import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isCompiledBinary, logger, VERSION } from "@oh-my-pi/pi-utils";
// Embedded as Bun.build assets so `bun build --compile` ships them inside
// the standalone binary (issue raised in #1028 review). At runtime the
// resolver below extracts them from the read-only `$bunfs` virtual FS to a
// real path before any `Bun.spawn()` exec.
import macAlerterWrapperAsset from "../../scripts/mac-alerter.sh" with { type: "file" };
import notifyClickAsset from "../../scripts/notify-click.sh" with { type: "file" };
import { shellQuoteAll } from "./shell-quote";
import type { NotificationOpts, TmuxFocusAction } from "./types";

/**
 * Resolve the macOS notifier binary OMP should shell out to, cached once per
 * process. We prefer `alerter` (Vincent Saluzzo's fork of terminal-notifier
 * with action-button support) because it ships its own bundle id and is the
 * standard `terminal-notifier`-family tool people install via Homebrew. We
 * fall through to plain `terminal-notifier` for the same reason.
 *
 * Both register their own LSApplication entry, so notifications attribute to
 * a "Terminal" / `>_` icon and survive when the active terminal emulator
 * (kitty, ghostty, alacritty, …) hasn't been granted notification permission
 * by the user.
 *
 * `null` means "neither tool is on $PATH"; the caller falls back to osascript.
 */
let macNotifierResolved = false;
let macNotifierPath: string | null = null;

export function findMacNotifier(): string | null {
	if (macNotifierResolved) return macNotifierPath;
	macNotifierResolved = true;
	for (const candidate of ["alerter", "terminal-notifier"]) {
		try {
			const result = Bun.spawnSync(["which", candidate], {
				stdout: "pipe",
				stderr: "ignore",
			});
			if (result.exitCode === 0) {
				const resolved = new TextDecoder().decode(result.stdout).trim();
				if (resolved) {
					macNotifierPath = resolved;
					return macNotifierPath;
				}
			}
		} catch {
			// `which` missing or sandboxed; try the next candidate.
		}
	}
	return macNotifierPath;
}

/**
 * Resolve a script asset to a real, executable on-disk path.
 *
 * In dev (running from source), the asset import resolves to the original
 * `.sh` file inside the package — return it verbatim.
 *
 * In a `bun build --compile` standalone binary the asset path lives inside
 * the read-only `$bunfs` virtual filesystem; the kernel can't `exec()` from
 * there. Extract the bytes to a stable per-version cache directory (with
 * `chmod +x`) on first use and return the extracted path. Subsequent calls
 * skip the write if the file already exists.
 */
let scriptCacheDir: string | undefined;
function getScriptCacheDir(): string {
	if (scriptCacheDir) return scriptCacheDir;
	scriptCacheDir = path.join(os.tmpdir(), `omp-notify-${VERSION}`);
	fs.mkdirSync(scriptCacheDir, { recursive: true });
	return scriptCacheDir;
}

const extractedScripts = new Map<string, string>();
export function resolveBundledScript(assetPath: string, basename: string): string {
	if (!isCompiledBinary()) return assetPath;
	const cached = extractedScripts.get(basename);
	if (cached) return cached;
	const target = path.join(getScriptCacheDir(), basename);
	if (!fs.existsSync(target)) {
		const buf = fs.readFileSync(assetPath);
		fs.writeFileSync(target, buf, { mode: 0o755 });
	} else {
		// Make sure the executable bit is set even when the file pre-existed
		// (e.g. an older OMP version wrote it without `mode`).
		try {
			fs.chmodSync(target, 0o755);
		} catch {
			// Best-effort; spawn will surface a clearer error if exec fails.
		}
	}
	extractedScripts.set(basename, target);
	return target;
}

/**
 * Click-handler script bundled with the TUI package. Receives session/window/
 * pane as three positional arguments. Resolved lazily so the extraction only
 * happens on the first notification dispatch (and only once per process).
 */
function getNotifyClickScript(): string {
	return resolveBundledScript(notifyClickAsset, "notify-click.sh");
}

/**
 * alerter wrapper — gives alerter terminal-notifier-style fire-and-forget
 * semantics by backgrounding the wait+route inside a detached subshell.
 * alerter has no `--execute` flag of its own; it returns the user's chosen
 * action on stdout and the wrapper does the click-handler dispatch.
 */
function getMacAlerterWrapper(): string {
	return resolveBundledScript(macAlerterWrapperAsset, "mac-alerter.sh");
}

/**
 * `true` when this notifier path is `alerter` (or its basename matches).
 * Exported for tests.
 */
export function isAlerter(notifier: string): boolean {
	return path.basename(notifier) === "alerter";
}

/**
 * Build the alerter / terminal-notifier argv for one notification.
 *
 * Exported for unit tests — the actual spawn happens in `sendMacNotification`.
 * Keeping the argv-builder pure (no IO) means tests don't need to mock spawn.
 *
 * **alerter** has no `--execute` flag, so we go through `mac-alerter.sh`
 * which wraps it in a detached subshell that waits for the action result and
 * routes click → notify-click.sh. The returned argv invokes the wrapper, NOT
 * alerter directly.
 *
 * **terminal-notifier** has built-in `-execute` (fire-and-forget) so we
 * invoke it directly with BSD-style short flags.
 */
export function buildMacNotifierArgs(
	notifier: string,
	opts: NotificationOpts,
	clickScript: string = getNotifyClickScript(),
	alerterWrapper: string = getMacAlerterWrapper(),
): string[] {
	if (isAlerter(notifier)) {
		// Wrapper signature:
		//   mac-alerter.sh <alerter_bin> <title> <subtitle> <body> <group>
		//                  <click_script> <session> <window> <pane>
		// All positional; empty strings are valid for absent fields.
		return [
			alerterWrapper,
			notifier,
			opts.title,
			opts.subtitle ?? "",
			opts.body,
			opts.group ?? "",
			opts.onClick ? clickScript : "",
			opts.onClick?.session ?? "",
			opts.onClick?.window ?? "",
			opts.onClick?.pane ?? "",
		];
	}

	// terminal-notifier (BSD-style flags). Order matches its man page.
	const args: string[] = [notifier, "-title", opts.title];
	if (opts.subtitle) args.push("-subtitle", opts.subtitle);
	args.push("-message", opts.body);
	if (opts.group) args.push("-group", opts.group);
	args.push("-sound", "default");
	if (opts.onClick) args.push("-execute", buildClickCommand(clickScript, opts.onClick));
	return args;
}

/**
 * Build the single shell-string passed to terminal-notifier's `-execute`.
 *
 * terminal-notifier hands the value to `/bin/sh -c`. The helper script takes
 * three positional args (session, window, pane); we shell-quote each so
 * session names with spaces, quotes, etc. survive intact.
 */
export function buildClickCommand(scriptPath: string, action: TmuxFocusAction): string {
	return shellQuoteAll([scriptPath, action.session, action.window, action.pane]);
}

/**
 * Send a macOS desktop notification through `alerter` or `terminal-notifier`.
 *
 * Fire-and-forget by design: completion notifications fire from synchronous
 * call sites, and a ~50–100ms spawn is fine because it happens once per
 * agent_end. The child is detached (`unref`) so it cannot keep the event
 * loop alive past process exit.
 *
 * No-op when neither notifier binary is on `$PATH`. We deliberately do not
 * fall back to `osascript display notification` because that path can't
 * carry a click callback (the whole reason these notifications exist is to
 * jump back to the tmux pane), and renders with a Script Editor icon that
 * doesn't match the user-facing UX. To avoid silent failure being a total
 * black box, we emit a single `logger.warn` line on the first missed
 * dispatch so the user can spot it in `~/.omp/logs/omp.YYYY-MM-DD.log`.
 */
let missingNotifierWarned = false;

export function sendMacNotification(opts: NotificationOpts): void {
	const notifier = findMacNotifier();
	if (!notifier) {
		if (!missingNotifierWarned) {
			missingNotifierWarned = true;
			logger.warn(
				"Desktop notification skipped: neither 'alerter' nor 'terminal-notifier' is on $PATH. " +
					"Install with 'brew install alerter' to enable completion/ask/plan-ready toasts.",
				{ title: opts.title },
			);
		}
		return;
	}
	try {
		const child = Bun.spawn(buildMacNotifierArgs(notifier, opts), {
			stdin: "ignore",
			stdout: "ignore",
			stderr: "ignore",
		});
		child.unref?.();
	} catch (err) {
		// Spawn-level failure (binary suddenly missing, sandbox, …) — log once
		// with the actual error so the user has a thread to pull on. Reuses
		// the same one-shot guard so a permission flap doesn't spam the log.
		if (!missingNotifierWarned) {
			missingNotifierWarned = true;
			logger.warn("Desktop notification spawn failed", {
				notifier,
				err: err instanceof Error ? err.message : String(err),
			});
		}
	}
}

/** Reset the notifier cache. Test-only. */
export function resetMacNotifierCacheForTesting(): void {
	macNotifierResolved = false;
	macNotifierPath = null;
}

/** Reset the one-shot missing-notifier warning guard. Test-only. */
export function resetMissingNotifierWarnedForTesting(): void {
	missingNotifierWarned = false;
}
