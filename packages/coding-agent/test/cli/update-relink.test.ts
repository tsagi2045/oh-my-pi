/**
 * `runDevTreeRelinkIfPresent` runs after a successful `omp update`. Three
 * behaviors matter:
 *   1. With $OMP_RELINK set to an executable script, it runs the script.
 *   2. With $OMP_RELINK set to a non-existent path, it silently no-ops.
 *   3. With $OMP_RELINK unset and ~/.local/bin/omp-relink missing, it
 *      silently no-ops (the production default path).
 *
 * Side-effect test: the script touches a sentinel file; we assert the file
 * exists after the call. Avoids mocking Bun.$ entirely.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runDevTreeRelinkIfPresent } from "@oh-my-pi/pi-coding-agent/cli/update-cli";

let tmpDir: string;
const originalRelink = Bun.env.OMP_RELINK;
const originalHome = Bun.env.HOME;

function setEnv(key: string, value: string | undefined): void {
	if (value === undefined) {
		delete (Bun.env as Record<string, string | undefined>)[key];
	} else {
		Bun.env[key] = value;
	}
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-relink-test-"));
});

afterEach(() => {
	setEnv("OMP_RELINK", originalRelink);
	setEnv("HOME", originalHome);
	try {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	} catch {
		// best-effort cleanup
	}
});

describe("runDevTreeRelinkIfPresent", () => {
	it("invokes the script when OMP_RELINK points to an executable file", async () => {
		// Build a script that creates a sentinel inside tmpDir on execution.
		// We check for that sentinel afterward to confirm the spawn happened.
		const sentinel = path.join(tmpDir, "ran");
		const script = path.join(tmpDir, "fake-relink");
		fs.writeFileSync(script, `#!/usr/bin/env bash\ntouch "${sentinel}"\n`, { mode: 0o755 });
		setEnv("OMP_RELINK", script);

		await runDevTreeRelinkIfPresent();

		expect(fs.existsSync(sentinel)).toBe(true);
	});

	it("silently no-ops when OMP_RELINK points to a missing file", async () => {
		setEnv("OMP_RELINK", path.join(tmpDir, "does-not-exist"));
		// Should not throw and should not produce any visible side effect.
		await runDevTreeRelinkIfPresent();
		// If we got here, the no-op happened cleanly.
		expect(true).toBe(true);
	});

	it("silently no-ops when OMP_RELINK is unset and the default path is absent", async () => {
		// Point HOME at our tmpDir so the default-resolved path
		// `<HOME>/.local/bin/omp-relink` does NOT exist.
		setEnv("OMP_RELINK", undefined);
		setEnv("HOME", tmpDir);
		await runDevTreeRelinkIfPresent();
		expect(true).toBe(true);
	});

	it("ignores OMP_RELINK that points to a non-executable file", async () => {
		// Plain text file with no executable bits — we should refuse to spawn
		// it (the check guards against accidentally running a config file or
		// data file just because it happens to live at the expected path).
		const sentinel = path.join(tmpDir, "ran");
		const script = path.join(tmpDir, "non-exec-relink");
		fs.writeFileSync(script, `#!/usr/bin/env bash\ntouch "${sentinel}"\n`, { mode: 0o644 });
		setEnv("OMP_RELINK", script);

		await runDevTreeRelinkIfPresent();

		expect(fs.existsSync(sentinel)).toBe(false);
	});
});
