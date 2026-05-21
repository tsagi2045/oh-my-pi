import { describe, expect, it } from "bun:test";
import { extractSegments, normalizeTerminalOutput, sliceWithWidth, truncateToWidth, visibleWidth } from "@oh-my-pi/pi-tui/utils";

describe("text utils", () => {
	it("computes visible width for ANSI and tabs", () => {
		const text = `\x1b[31mhi\tthere\x1b[0m`;
		expect(visibleWidth(text)).toBe(2 + 3 + 5);
	});

	it("ignores OSC hyperlinks in visible width", () => {
		const text = "\x1b]8;;https://example.com\x07link\x1b]8;;\x07";
		expect(visibleWidth(text)).toBe(4);
	});

	it("truncates ANSI text with ellipsis", () => {
		const text = "\x1b[31mhello world\x1b[0m";
		const result = truncateToWidth(text, 6);
		expect(result.includes("\x1b[0m…")).toBe(true);
		expect(visibleWidth(result)).toBe(6);
	});

	it("slices visible columns while preserving ANSI", () => {
		const text = "\x1b[31mhello\x1b[0m world";
		const result = sliceWithWidth(text, 1, 4, true);
		expect(result.text.startsWith("\x1b[31mello")).toBe(true);
		expect(result.width).toBe(4);
	});

	it("extracts segments with inherited styling", () => {
		const text = "\x1b[31mhello world\x1b[0m";
		const result = extractSegments(text, 3, 6, 5, true);
		expect(result.before).toContain("hel");
		expect(result.after.startsWith("\x1b[31m")).toBe(true);
		expect(result.afterWidth).toBeGreaterThan(0);
	});

	it("treats NFD Hangul jamo as composed syllables for width", () => {
		// macOS APFS returns filenames in NFD (Hangul jamo, U+1100..U+11FF).
		// `Bun.stringWidth` counts each jamo separately (2 + 1 = 3 cells for
		// `화`), but the terminal composes them and renders a single 2-cell
		// syllable. visibleWidth must report the rendered width (2), not the
		// per-codepoint sum, or OMP's cursor tracking drifts past the visible
		// glyph.
		const nfc = "화면 기록"; // 4 syllables + 1 space = 9 cells
		const nfd = nfc.normalize("NFD");
		expect(nfd).not.toBe(nfc);
		expect(visibleWidth(nfc)).toBe(9);
		expect(visibleWidth(nfd)).toBe(9);
	});

	it("slices NFD Hangul by composed-syllable columns", () => {
		const nfd = "화면 기록".normalize("NFD");
		// First two syllables = 4 cells. Slice must return the NFC form so the
		// terminal renders 4 cells, not the partial jamo sequence that would
		// otherwise leave dangling combining marks.
		const result = sliceWithWidth(nfd, 0, 4, true);
		expect(result.width).toBe(4);
		expect(result.text).toBe("화면");
	});

	it("composes NFD Hangul to NFC in normalizeTerminalOutput", () => {
		const nfd = "/Users/leo/Documents/BROS/images/지노 가게/광고".normalize("NFD");
		const out = normalizeTerminalOutput(nfd);
		expect(out).toBe("/Users/leo/Documents/BROS/images/지노 가게/광고");
	});

	it("normalizeTerminalOutput is a no-op for ASCII", () => {
		const ascii = "$ ls -la /tmp";
		expect(normalizeTerminalOutput(ascii)).toBe(ascii);
	});
});
