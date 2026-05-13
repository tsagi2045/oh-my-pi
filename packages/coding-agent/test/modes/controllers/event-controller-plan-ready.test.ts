/**
 * The desktop completion notification has two faces:
 *   - Default: `Task complete` with the last assistant text as the body.
 *   - After exit_plan_mode: `Plan ready` with the plan title as the body.
 *
 * The "after exit_plan_mode" signal is captured per-turn inside
 * EventController, then read once at sendCompletionNotification time and
 * cleared. The next turn must start without that flag set. Three tests:
 *   1. plan-ready dispatch fires with the right title/body/group
 *   2. a regular completion (no exit_plan_mode) still says "Task complete"
 *   3. agent_start resets the per-turn flag so it can't leak across turns
 */
import { afterEach, beforeEach, describe, expect, it, spyOn, vi } from "bun:test";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import { TERMINAL } from "@oh-my-pi/pi-tui";
import { _resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { EventController } from "@oh-my-pi/pi-coding-agent/modes/controllers/event-controller";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";

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

	it("renders a distinct 'Plan ready' toast after exit_plan_mode and consumes the flag", async () => {
		const ctx = createContext();
		const controller = new EventController(ctx);

		// Drive the exit_plan_mode tool branch — sets the per-turn flag and
		// awaits the (stubbed) handleExitPlanModeTool, which would normally
		// abort the session and fire agent_end.
		await controller.handleEvent({
			type: "tool_execution_end",
			toolName: "exit_plan_mode",
			toolCallId: "call-1",
			isError: false,
			result: {
				content: [],
				details: {
					planFilePath: "/tmp/plan.md",
					planExists: false,
					title: "WP_MIGRATION_PLAN",
					finalPlanFilePath: "/tmp/WP_MIGRATION_PLAN.md",
				},
			},
		} as never);

		controller.sendCompletionNotification();

		expect(sendSpy).toHaveBeenCalledTimes(1);
		const payload = sendSpy.mock.calls[0][0] as {
			title: string;
			body: string;
			group: string;
		};
		expect(payload.title).toBe("Plan ready");
		expect(payload.body).toBe("WP_MIGRATION_PLAN");
		// Distinct group key ensures the plan-ready entry doesn't get collapsed
		// by a subsequent regular completion in Notification Center.
		expect(payload.group).toBe("omp-plan-sid-123");

		// Calling again must NOT re-emit "Plan ready" — the flag is one-shot,
		// consumed by the first dispatch.
		sendSpy.mockClear();
		controller.sendCompletionNotification();
		expect(sendSpy).toHaveBeenCalledTimes(1);
		const second = sendSpy.mock.calls[0][0] as { title: string };
		expect(second.title).toBe("Task complete");
	});

	it("renders the default 'Task complete' toast when no exit_plan_mode happened", () => {
		const ctx = createContext();
		const controller = new EventController(ctx);

		controller.sendCompletionNotification();

		expect(sendSpy).toHaveBeenCalledTimes(1);
		const payload = sendSpy.mock.calls[0][0] as { title: string; group: string };
		expect(payload.title).toBe("Task complete");
		expect(payload.group).toBe("omp-stop-sid-123");
	});

	it("clears the plan-mode flag on agent_start so it cannot leak across turns", async () => {
		const ctx = createContext();
		const controller = new EventController(ctx);

		// Turn 1: exit_plan_mode fires but we never call sendCompletionNotification.
		await controller.handleEvent({
			type: "tool_execution_end",
			toolName: "exit_plan_mode",
			toolCallId: "call-1",
			isError: false,
			result: {
				content: [],
				details: {
					planFilePath: "/tmp/plan.md",
					planExists: false,
					title: "LEAKED_PLAN",
					finalPlanFilePath: "/tmp/LEAKED_PLAN.md",
				},
			},
		} as never);

		// Turn 2 begins: agent_start must clear the captured plan details.
		await controller.handleEvent({ type: "agent_start" } as never);
		controller.sendCompletionNotification();

		expect(sendSpy).toHaveBeenCalledTimes(1);
		const payload = sendSpy.mock.calls[0][0] as { title: string };
		expect(payload.title).toBe("Task complete");
	});
});
