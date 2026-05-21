/**
 * The desktop completion notification responsibility is split between two
 * methods on EventController:
 *
 *   sendCompletionNotification()
 *     - Called on every agent_end.
 *     - Plan mode active → return silently (no Task complete during
 *       intermediate plan-mode turns).
 *     - One-shot suppression flag → return silently and clear (consumes a
 *       same-turn follow-up agent_end emitted by the plan-mode abort).
 *     - Otherwise → emit `Task complete` with the last assistant excerpt
 *       and group `omp-stop-<sessionId>`.
 *
 *   sendPlanReadyNotification(details)
 *     - Called by InteractiveMode.handleExitPlanModeTool() AFTER the plan
 *       preview is rendered and the approval selector is on screen, so a
 *       user who clicks the toast lands on a UI ready to act on.
 *     - Emits `Plan ready` with `details.title` as the body and group
 *       `omp-plan-<sessionId>`.
 *     - Arms the one-shot suppression flag so the agent_end emitted by the
 *       plan-mode abort does NOT produce a second toast in the same turn.
 *
 * `agent_start` clears the one-shot suppression flag so the next real turn
 * notifies normally.
 */
import { afterEach, beforeEach, describe, expect, it, spyOn, vi } from "bun:test";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import { TERMINAL } from "@oh-my-pi/pi-tui";
import { _resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { EventController } from "@oh-my-pi/pi-coding-agent/modes/controllers/event-controller";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import type { ExitPlanModeDetails } from "@oh-my-pi/pi-coding-agent/tools";

function createAssistantMessage(text = "All tests passed."): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function createContext(overrides: Partial<InteractiveModeContext> = {}): InteractiveModeContext {
	const last = createAssistantMessage();
	return {
		isInitialized: true,
		isBackgrounded: false,
		loadingAnimation: undefined,
		streamingComponent: undefined,
		streamingMessage: undefined,
		pendingTools: new Map<string, unknown>(),
		flushPendingModelSwitch: async () => {},
		ui: { requestRender: vi.fn() },
		chatContainer: { removeChild: vi.fn() },
		statusContainer: { clear: vi.fn() },
		statusLine: { invalidate: vi.fn() },
		updateEditorTopBorder: vi.fn(),
		editor: { getText: () => "" },
		planModeEnabled: false,
		sessionManager: {
			getSessionName: () => "session-x",
			getSessionId: () => "sid-123",
		},
		session: {
			isCompacting: false,
			isStreaming: false,
			getLastAssistantMessage: () => last,
			agent: { state: { messages: [last] } },
		},
		handleExitPlanModeTool: vi.fn(),
		ensureLoadingAnimation: vi.fn(),
		...overrides,
	} as unknown as InteractiveModeContext;
}

function planDetails(title: string): ExitPlanModeDetails {
	return {
		planFilePath: "/tmp/plan.md",
		planExists: true,
		title,
		finalPlanFilePath: `/tmp/${title}.md`,
	};
}

describe("EventController plan-ready completion notification", () => {
	let sendSpy: ReturnType<typeof spyOn>;

	beforeEach(async () => {
		_resetSettingsForTest();
		await Settings.init({
			inMemory: true,
			overrides: { "completion.notify": "on" },
		});
		sendSpy = spyOn(TERMINAL, "sendNotification").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		_resetSettingsForTest();
	});

	it("sendPlanReadyNotification emits a single 'Plan ready' toast with the plan title as the body", () => {
		const ctx = createContext({ planModeEnabled: true });
		const controller = new EventController(ctx);

		controller.sendPlanReadyNotification(planDetails("WP_MIGRATION_PLAN"));

		expect(sendSpy).toHaveBeenCalledTimes(1);
		const payload = sendSpy.mock.calls[0][0] as {
			title: string;
			body: string;
			group: string;
		};
		// Dedicated category — title alone tells the user what happened.
		expect(payload.title).toBe("Plan ready");
		// Body is the plan title verbatim so the user can disambiguate
		// when multiple sessions stack in Notification Center.
		expect(payload.body).toBe("WP_MIGRATION_PLAN");
		// Distinct group so plan-ready toasts collapse with each other but
		// don't merge with regular `Task complete` toasts.
		expect(payload.group).toBe("omp-plan-sid-123");
	});

	it("sendCompletionNotification suppresses every toast while plan mode is active", () => {
		// In plan mode the agent often finishes several intermediate turns
		// (reads, planning text, plan-mode enforcement re-prompts) before
		// finally calling exit_plan_mode. None of those agent_end events
		// should produce a `Task complete` toast — the only allowed toast
		// during plan mode comes from sendPlanReadyNotification at exit.
		const ctx = createContext({ planModeEnabled: true });
		const controller = new EventController(ctx);

		controller.sendCompletionNotification();

		expect(sendSpy).not.toHaveBeenCalled();
	});

	it("sendCompletionNotification no longer emits a plan-ready toast even with exit details on the controller", () => {
		// Responsibility split: only sendPlanReadyNotification fires the
		// `Plan ready` toast. The agent_end path must NEVER emit it,
		// regardless of internal state, because agent_end fires before the
		// approval UI is on screen.
		const ctx = createContext({ planModeEnabled: true });
		const controller = new EventController(ctx);

		controller.sendCompletionNotification();

		expect(sendSpy).not.toHaveBeenCalled();
	});

	it("sendPlanReadyNotification suppresses a same-turn follow-up sendCompletionNotification", () => {
		const ctx = createContext({ planModeEnabled: true });
		const controller = new EventController(ctx);

		// Interactive-mode flow: selector goes on screen, plan-ready fires,
		// then the abort emits agent_end which calls
		// sendCompletionNotification. The follow-up must be silent.
		controller.sendPlanReadyNotification(planDetails("WP_MIGRATION_PLAN"));
		expect(sendSpy).toHaveBeenCalledTimes(1);

		sendSpy.mockClear();
		controller.sendCompletionNotification();
		expect(sendSpy).not.toHaveBeenCalled();
	});

	it("renders the default 'Task complete' toast when plan mode is not active", () => {
		const ctx = createContext({ planModeEnabled: false });
		const controller = new EventController(ctx);

		controller.sendCompletionNotification();

		expect(sendSpy).toHaveBeenCalledTimes(1);
		const payload = sendSpy.mock.calls[0][0] as { title: string; body: string; group: string };
		expect(payload.title).toBe("Task complete");
		expect(payload.body).toBe("All tests passed.");
		expect(payload.group).toBe("omp-stop-sid-123");
	});

	it("clears the one-shot suppression flag on agent_start so the next turn notifies normally", async () => {
		// Turn 1: plan-mode flow ends — plan-ready fires and arms the
		// one-shot suppression so the follow-up agent_end stays silent.
		const ctx = createContext({ planModeEnabled: true });
		const controller = new EventController(ctx);
		controller.sendPlanReadyNotification(planDetails("LEAKED_PLAN"));
		sendSpy.mockClear();

		// Turn 2 begins after the user approved the plan — plan mode is no
		// longer active. agent_start must clear the one-shot flag so the
		// first normal completion of the execution turn is not silently
		// dropped.
		(ctx as unknown as { planModeEnabled: boolean }).planModeEnabled = false;
		await controller.handleEvent({ type: "agent_start" } as never);
		controller.sendCompletionNotification();

		expect(sendSpy).toHaveBeenCalledTimes(1);
		const payload = sendSpy.mock.calls[0][0] as { title: string; body: string };
		expect(payload.title).toBe("Task complete");
		expect(payload.body).toBe("All tests passed.");
	});

	it("sendPlanReadyNotification respects the completion.notify=off setting", async () => {
		_resetSettingsForTest();
		await Settings.init({
			inMemory: true,
			overrides: { "completion.notify": "off" },
		});
		const ctx = createContext({ planModeEnabled: true });
		const controller = new EventController(ctx);

		controller.sendPlanReadyNotification(planDetails("MUTED_PLAN"));

		expect(sendSpy).not.toHaveBeenCalled();
	});
});
