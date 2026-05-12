import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getTerminalInfo } from "@oh-my-pi/pi-tui";

const KITTY = getTerminalInfo("kitty"); // OSC 99
const ITERM = getTerminalInfo("iterm2"); // OSC 9
const VSCODE = getTerminalInfo("vscode"); // Bell
const originalTmux = Bun.env.TMUX;

function setTmux(value: string | undefined): void {
	if (value === undefined) {
		delete (Bun.env as Record<string, string | undefined>).TMUX;
	} else {
		Bun.env.TMUX = value;
	}
}

describe("TerminalInfo.formatNotification", () => {
	beforeEach(() => {
		setTmux(undefined);
	});

	afterEach(() => {
		setTmux(originalTmux);
	});

	it("emits raw OSC 99 outside tmux", () => {
		expect(KITTY.formatNotification("Done")).toBe("\x1b]99;;Done\x1b\\");
	});

	it("emits raw OSC 9 outside tmux", () => {
		expect(ITERM.formatNotification("Done")).toBe("\x1b]9;Done\x1b\\");
	});

	it("emits bare bell regardless of tmux", () => {
		setTmux("/tmp/tmux-1000/default,1,0");
		expect(VSCODE.formatNotification("Done")).toBe("\x07");
	});

	it("wraps OSC sequences in tmux DCS passthrough when TMUX is set", () => {
		setTmux("/tmp/tmux-1000/default,1,0");
		// tmux DCS passthrough: \ePtmux;<sequence-with-doubled-ESC>\e\\
		expect(KITTY.formatNotification("Done")).toBe("\x1bPtmux;\x1b\x1b]99;;Done\x1b\x1b\\\x1b\\");
		expect(ITERM.formatNotification("Done")).toBe("\x1bPtmux;\x1b\x1b]9;Done\x1b\x1b\\\x1b\\");
	});

	it("escapes embedded ESC bytes in the message payload", () => {
		setTmux("/tmp/tmux-1000/default,1,0");
		// User-supplied ESC inside the message must also be doubled so tmux
		// does not terminate the DCS envelope early.
		const message = "a\x1bb";
		const out = KITTY.formatNotification(message);
		expect(out).toBe("\x1bPtmux;\x1b\x1b]99;;a\x1b\x1bb\x1b\x1b\\\x1b\\");
		expect(out.startsWith("\x1bPtmux;")).toBe(true);
		expect(out.endsWith("\x1b\\")).toBe(true);
	});
});
