/**
 * Excerpt helpers feed user-visible notification body text. They have two
 * jobs:
 *   1. Pull the right field out of the right structure.
 *   2. Collapse whitespace + truncate so the toast is one readable block.
 *
 * Post-redesign both helpers use a 200-char limit (matches macOS's own
 * effective body wrap) so the user gets "내용 그대로" within the toast
 * width budget, instead of the previous aggressive 80/60-char clips.
 *
 * If either side breaks the user gets a confusing or empty notification, so
 * we lock the contract here. Nothing else asserts on these helpers.
 */
import { describe, expect, it } from "bun:test";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import { excerptAssistantMessage } from "@oh-my-pi/pi-coding-agent/modes/controllers/event-controller";
import { excerptAskPrompt } from "@oh-my-pi/pi-coding-agent/tools/ask";

function assistant(content: AssistantMessage["content"]): AssistantMessage {
	// Minimal AssistantMessage stub — only `role` and `content` are read by
	// excerptAssistantMessage, everything else is irrelevant for this contract.
	return {
		role: "assistant",
		content,
		usage: { input: 0, output: 0 },
		stopReason: "end_turn",
	} as unknown as AssistantMessage;
}

describe("excerptAssistantMessage", () => {
	it("returns undefined when the message is absent", () => {
		expect(excerptAssistantMessage(undefined)).toBeUndefined();
	});

	it("returns undefined when there is no text block (tool-only turn)", () => {
		// Pure tool-use turns shouldn't produce a notification body — the
		// caller substitutes a fallback string instead of leaking JSON.
		const msg = assistant([{ type: "toolCall", id: "x", name: "bash", arguments: { command: "ls" } }]);
		expect(excerptAssistantMessage(msg)).toBeUndefined();
	});

	it("returns undefined when the text block is whitespace only", () => {
		const msg = assistant([{ type: "text", text: "   \n\t  " }]);
		expect(excerptAssistantMessage(msg)).toBeUndefined();
	});

	it("returns the first text block verbatim when short", () => {
		const msg = assistant([{ type: "text", text: "All tests passed." }]);
		expect(excerptAssistantMessage(msg)).toBe("All tests passed.");
	});

	it("collapses internal whitespace (newlines, tabs, runs of spaces) into single spaces", () => {
		// macOS notification bodies render newlines as line breaks; we want a
		// single line of text in the toast so the visual size stays predictable.
		const msg = assistant([{ type: "text", text: "line one\n\n   line\ttwo" }]);
		expect(excerptAssistantMessage(msg)).toBe("line one line two");
	});

	it("trims leading/trailing whitespace after collapse", () => {
		const msg = assistant([{ type: "text", text: "  hello world  " }]);
		expect(excerptAssistantMessage(msg)).toBe("hello world");
	});

	it("clips to 199 characters + ellipsis when content exceeds 200", () => {
		// 200-char cap (post-redesign): both alerter and macOS NC wrap longer
		// bodies onto multiple lines gracefully, but past ~200 macOS itself
		// starts truncating. Matching that ceiling avoids double-truncation
		// while keeping toasts a sensible visual size.
		const long = "x".repeat(400);
		const result = excerptAssistantMessage(assistant([{ type: "text", text: long }]));
		// 199 chars of content + 1 char ellipsis = 200 total.
		expect(result).toHaveLength(200);
		expect(result?.endsWith("…")).toBe(true);
		expect(result?.startsWith("x".repeat(199))).toBe(true);
	});

	it("does not append ellipsis when content fits exactly in 200 characters", () => {
		const exact = "y".repeat(200);
		expect(excerptAssistantMessage(assistant([{ type: "text", text: exact }]))).toBe(exact);
	});

	it("preserves a 199-char body verbatim (just under the truncation threshold)", () => {
		// Boundary check the other direction — make sure the off-by-one logic
		// in `slice(0, limit - 1)` doesn't kick in for ≤200 inputs.
		const short = "z".repeat(199);
		expect(excerptAssistantMessage(assistant([{ type: "text", text: short }]))).toBe(short);
	});

	it("picks the FIRST text block when multiple coexist with tool calls", () => {
		// Real assistant turns commonly have a thinking/text preamble followed
		// by a tool call followed by another text block. The notification
		// should preview the user-facing summary, not the post-tool blurb.
		const msg = assistant([
			{ type: "text", text: "First summary line." },
			{ type: "toolCall", id: "x", name: "bash", arguments: { command: "ls" } },
			{ type: "text", text: "Post-tool followup." },
		]);
		expect(excerptAssistantMessage(msg)).toBe("First summary line.");
	});
});

describe("excerptAskPrompt", () => {
	it("returns undefined for an empty questions array", () => {
		expect(excerptAskPrompt({ questions: [] })).toBeUndefined();
	});

	it("returns undefined when the first question is whitespace-only", () => {
		expect(
			excerptAskPrompt({
				questions: [{ id: "q1", question: "   \n   ", options: [{ label: "y" }] }],
			}),
		).toBeUndefined();
	});

	it("returns the first question text when short", () => {
		expect(
			excerptAskPrompt({
				questions: [{ id: "q1", question: "Use JWT or sessions?", options: [{ label: "JWT" }] }],
			}),
		).toBe("Use JWT or sessions?");
	});

	it("collapses whitespace runs into a single space", () => {
		expect(
			excerptAskPrompt({
				questions: [{ id: "q1", question: "do\n\tthis\n  or\nthat?", options: [{ label: "yes" }] }],
			}),
		).toBe("do this or that?");
	});

	it("clips to 199 characters + ellipsis when the question exceeds 200", () => {
		// Same 200-char cap as `excerptAssistantMessage` — the two helpers
		// share an implicit contract because they both feed the same macOS
		// toast body slot.
		const long = "y".repeat(400);
		const result = excerptAskPrompt({
			questions: [{ id: "q1", question: long, options: [{ label: "ok" }] }],
		});
		expect(result).toHaveLength(200);
		expect(result?.endsWith("…")).toBe(true);
	});

	it("only excerpts the FIRST question even when multiple are passed", () => {
		// `ask` lets callers bundle several questions into one dialog; the
		// notification body shows only the first because that's what the
		// dialog also opens with. Showing all of them would overflow the
		// toast.
		const result = excerptAskPrompt({
			questions: [
				{ id: "q1", question: "First question.", options: [{ label: "ok" }] },
				{ id: "q2", question: "Second question.", options: [{ label: "ok" }] },
			],
		});
		expect(result).toBe("First question.");
	});
});
