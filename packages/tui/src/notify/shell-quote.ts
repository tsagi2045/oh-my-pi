/**
 * POSIX shell single-argument quoter.
 *
 * Emits a string that, when expanded by `/bin/sh -c`, evaluates back to the
 * original input verbatim — no shell metacharacter survives unescaped. We
 * need this because alerter / terminal-notifier's `--execute` flag takes
 * exactly ONE shell-string and the inner script receives positional args
 * after `sh -c` parsing.
 *
 * Strategy: wrap in single quotes, replacing every internal `'` with the
 * canonical `'\''` sequence (close-quote, escaped-quote, reopen-quote). This
 * survives newlines, spaces, `$`, backticks, double quotes, and backslashes
 * without further escaping because nothing is special inside POSIX single
 * quotes except `'` itself.
 *
 * Empty string is quoted to `''` (a valid empty positional argument).
 */
export function shellQuote(value: string): string {
	if (value === "") return "''";
	return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * Quote and join a sequence of shell arguments into a single command string.
 * Convenience for the common case of calling a script with positional args.
 */
export function shellQuoteAll(values: ReadonlyArray<string>): string {
	return values.map(shellQuote).join(" ");
}
