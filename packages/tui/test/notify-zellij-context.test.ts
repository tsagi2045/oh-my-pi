import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { getZellijContext, resetZellijContextForTesting } from "@oh-my-pi/pi-tui";

type SpawnResult = ReturnType<typeof Bun.spawnSync>;

const ORIGINAL_ENV = {
	ZELLIJ: process.env.ZELLIJ,
	ZELLIJ_SESSION_NAME: process.env.ZELLIJ_SESSION_NAME,
	ZELLIJ_PANE_ID: process.env.ZELLIJ_PANE_ID,
};

function spawnResult(stdout: string, exitCode = 0): SpawnResult {
	return {
		exitCode,
		stdout: Buffer.from(stdout),
		stderr: Buffer.alloc(0),
		success: exitCode === 0,
		signalCode: null,
		resourceUsage: () => ({}) as never,
		pid: 0,
	} as unknown as SpawnResult;
}

describe("getZellijContext", () => {
	let spawnSpy: ReturnType<typeof spyOn> | undefined;

	beforeEach(() => {
		resetZellijContextForTesting();
	});

	afterEach(() => {
		spawnSpy?.mockRestore();
		process.env.ZELLIJ = ORIGINAL_ENV.ZELLIJ;
		process.env.ZELLIJ_SESSION_NAME = ORIGINAL_ENV.ZELLIJ_SESSION_NAME;
		process.env.ZELLIJ_PANE_ID = ORIGINAL_ENV.ZELLIJ_PANE_ID;
		resetZellijContextForTesting();
	});

	it("returns null when zellij env markers are absent", () => {
		delete process.env.ZELLIJ;
		delete process.env.ZELLIJ_SESSION_NAME;
		delete process.env.ZELLIJ_PANE_ID;
		spawnSpy = spyOn(Bun, "spawnSync");
		expect(getZellijContext()).toBeNull();
		expect(spawnSpy).not.toHaveBeenCalled();
	});

	it("returns the tab attached to the OMP pane, not the currently focused tab", () => {
		// Regression: previously the resolver called `zellij action current-tab-info`
		// which surfaces whichever tab is FOCUSED at CLI invocation time. If the
		// user happens to be looking at tab 'RAEOAK' (tab_id=0) when OMP fires
		// a notification while OMP itself lives in tab 'BROS' (tab_id=1, pane 5),
		// the toast subtitle wrongly said RAEOAK. The fix reads `list-panes`
		// and uses the pane's own `tab_id` / `tab_name`.
		process.env.ZELLIJ = "0";
		process.env.ZELLIJ_SESSION_NAME = "main";
		process.env.ZELLIJ_PANE_ID = "5";
		spawnSpy = spyOn(Bun, "spawnSync").mockImplementation((argv) => {
			const args = argv as string[];
			if (args.join(" ") === "zellij action list-panes --all --json") {
				return spawnResult(
					JSON.stringify([
						// Focused tab in a different project — would have been
						// returned by the old current-tab-info path.
						{ id: 9, is_plugin: false, title: "git status", tab_id: 0, tab_name: "RAEOAK" },
						// OMP pane lives here.
						{ id: 5, is_plugin: false, title: "π: omp", tab_id: 1, tab_name: "BROS" },
						{ id: 0, is_plugin: true, title: "zellij:tab-bar", tab_id: 0, tab_name: "RAEOAK" },
					]),
				);
			}
			throw new Error(`Unexpected spawn: ${args.join(" ")}`);
		});

		expect(getZellijContext()).toEqual({
			kind: "zellij",
			session: "main",
			window: "1",
			pane: "5",
			windowName: "BROS",
			paneTitle: "π: omp",
		});
	});

	it("matches a terminal_N pane env against numeric pane ids", () => {
		process.env.ZELLIJ = "0";
		process.env.ZELLIJ_SESSION_NAME = "main";
		process.env.ZELLIJ_PANE_ID = "terminal_5";
		spawnSpy = spyOn(Bun, "spawnSync").mockImplementation((argv) => {
			const args = argv as string[];
			if (args.join(" ") === "zellij action list-panes --all --json") {
				return spawnResult(
					JSON.stringify([{ id: 5, is_plugin: false, title: "π: omp", tab_id: 2, tab_name: "BROS" }]),
				);
			}
			throw new Error(`Unexpected spawn: ${args.join(" ")}`);
		});

		const ctx = getZellijContext();
		expect(ctx?.pane).toBe("terminal_5");
		expect(ctx?.paneTitle).toBe("π: omp");
		expect(ctx?.windowName).toBe("BROS");
	});

	it("re-resolves on every call so live tab moves and renames are reflected", () => {
		// Pane stays at id 5 but moves from tab 'work' → tab 'BROS'. Without
		// caching, the second call returns the updated tab info.
		process.env.ZELLIJ = "0";
		process.env.ZELLIJ_SESSION_NAME = "main";
		process.env.ZELLIJ_PANE_ID = "5";
		let callCount = 0;
		spawnSpy = spyOn(Bun, "spawnSync").mockImplementation((argv) => {
			const args = argv as string[];
			if (args.join(" ") === "zellij action list-panes --all --json") {
				callCount += 1;
				const tabName = callCount === 1 ? "work" : "BROS";
				const tabId = callCount === 1 ? 0 : 1;
				return spawnResult(
					JSON.stringify([
						{ id: 5, is_plugin: false, title: "π: omp", tab_id: tabId, tab_name: tabName },
					]),
				);
			}
			throw new Error(`Unexpected spawn: ${args.join(" ")}`);
		});

		expect(getZellijContext()?.windowName).toBe("work");
		expect(getZellijContext()?.windowName).toBe("BROS");
		expect(callCount).toBe(2);
	});
});
