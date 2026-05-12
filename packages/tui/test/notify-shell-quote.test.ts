import { describe, expect, it } from "bun:test";
import { shellQuote } from "@oh-my-pi/pi-tui/notify/shell-quote";

describe("shellQuote", () => {
	it("wraps simple values in single quotes", () => {
		expect(shellQuote("foo")).toBe("'foo'");
	});

	it("represents an empty string as a literal empty argument", () => {
		// alerter --execute receives the result via /bin/sh -c; an empty
		// positional arg must round-trip as `''`, not vanish.
		expect(shellQuote("")).toBe("''");
	});

	it("preserves spaces", () => {
		expect(shellQuote("with spaces")).toBe("'with spaces'");
	});

	it("escapes embedded single quotes via close-escape-reopen", () => {
		// `it's` -> `'it'\''s'`. Round-trips through /bin/sh -c as the
		// literal string `it's`.
		expect(shellQuote("it's")).toBe("'it'\\''s'");
	});

	it("escapes multiple single quotes", () => {
		expect(shellQuote("'''")).toBe("''\\'''\\'''\\'''");
	});

	it("preserves backslashes verbatim inside single quotes", () => {
		// Single quotes are POSIX literal — backslashes survive untouched,
		// no double-escaping required.
		expect(shellQuote("path\\with\\backslashes")).toBe("'path\\with\\backslashes'");
	});

	it("preserves newlines verbatim", () => {
		expect(shellQuote("line1\nline2")).toBe("'line1\nline2'");
	});

	it("preserves shell metacharacters as literal", () => {
		// `$VAR`, `*`, `&`, `|`, `;`, backticks must NOT be re-interpreted by
		// the shell that sees the quoted form. Single quotes are the only POSIX
		// quoting style that disables ALL of these in one rule.
		const tricky = "$VAR; rm -rf /; `whoami`; *.txt; a&b|c";
		expect(shellQuote(tricky)).toBe(`'${tricky}'`);
	});
});
