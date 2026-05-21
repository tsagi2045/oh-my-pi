import type { NotificationFocusAction } from "./types";

type ZellijPaneInfo = {
	id?: number;
	is_plugin?: boolean;
	title?: string;
	tab_id?: number;
	tab_name?: string;
};

/**
 * Resolves the current Zellij session/tab/pane for click-jump callbacks.
 *
 * Looks up the OMP pane (identified by `$ZELLIJ_PANE_ID`) in `zellij action
 * list-panes --all --json` and returns the tab info attached to that pane.
 *
 * Crucially we do NOT use `zellij action current-tab-info` here: it returns
 * whatever tab Zellij considers "focused" at the moment of the CLI call,
 * which is decoupled from where the OMP pane actually lives. If the user
 * happens to be looking at another tab when a notification fires, the wrong
 * tab name would show up in the toast subtitle. Resolving via the pane's own
 * `tab_id` is correct regardless of focus state.
 *
 * Resolution is uncached on purpose. Zellij lets the user move panes between
 * tabs and rename tabs at runtime, so any cached tab name goes stale. One
 * `zellij action list-panes` spawn per notification dispatch is cheap (~10-
 * 30ms) and notifications are infrequent.
 */
export function getZellijContext(): NotificationFocusAction | null {
	const pane = process.env.ZELLIJ_PANE_ID;
	const session = process.env.ZELLIJ_SESSION_NAME;
	const zellijEnv = process.env.ZELLIJ;
	if (!pane || !session || !zellijEnv) return null;

	try {
		const panes = readPaneList();
		if (!panes) return null;
		const barePaneId = pane.replace(/^terminal_/, "");
		const matchedPane = panes.find(
			(candidate) => !candidate.is_plugin && String(candidate.id) === barePaneId,
		);
		if (!matchedPane || typeof matchedPane.tab_id !== "number") return null;
		return {
			kind: "zellij",
			session,
			window: String(matchedPane.tab_id),
			pane,
			windowName: typeof matchedPane.tab_name === "string" ? matchedPane.tab_name : "",
			paneTitle: typeof matchedPane.title === "string" ? matchedPane.title : "",
		};
	} catch {
		return null;
	}
}

function readPaneList(): ZellijPaneInfo[] | null {
	const result = Bun.spawnSync(["zellij", "action", "list-panes", "--all", "--json"], {
		stdout: "pipe",
		stderr: "ignore",
	});
	if (result.exitCode !== 0) return null;
	const out = new TextDecoder().decode(result.stdout).trim();
	if (!out) return null;
	return JSON.parse(out) as ZellijPaneInfo[];
}

/**
 * Reset hook kept for API compatibility. Resolution is now uncached so this
 * is a no-op — tests can spy on `Bun.spawnSync` directly to control the
 * `list-panes` response per call.
 */
export function resetZellijContextForTesting(): void {
	// no-op
}
