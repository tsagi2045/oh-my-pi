import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { _detectDevTreeForTest, _resolveUpdateMethodForTest } from "../src/cli/update-cli";

describe("update-cli install target detection", () => {
	it("uses bun update when prioritized omp is inside bun global bin", () => {
		const method = _resolveUpdateMethodForTest("/Users/test/.bun/bin/omp", "/Users/test/.bun/bin");

		expect(method).toBe("bun");
	});

	it("uses binary update when prioritized omp is outside bun global bin", () => {
		const method = _resolveUpdateMethodForTest("/Users/test/.local/bin/omp", "/Users/test/.bun/bin");

		expect(method).toBe("binary");
	});

	it("uses binary update when bun global bin cannot be resolved", () => {
		const method = _resolveUpdateMethodForTest("/Users/test/.local/bin/omp", undefined);

		expect(method).toBe("binary");
	});
});

describe("update-cli dev-tree detection", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-devtree-"));
	});

	afterEach(() => {
		try {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		} catch {
			// best-effort cleanup
		}
	});

	function makeBunBinDir(): string {
		const bunBin = path.join(tmpDir, ".bun", "bin");
		fs.mkdirSync(bunBin, { recursive: true });
		return bunBin;
	}

	function makeRegistryInstall(bunBin: string): { ompShim: string; cli: string } {
		// Layout mimics `bun install -g @oh-my-pi/pi-coding-agent`:
		//   <tmp>/.bun/bin/omp -> ../install/global/node_modules/@oh-my-pi/pi-coding-agent/src/cli.ts
		//   <tmp>/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/cli.ts (real file)
		const pkgDir = path.join(
			tmpDir,
			".bun",
			"install",
			"global",
			"node_modules",
			"@oh-my-pi",
			"pi-coding-agent",
		);
		fs.mkdirSync(path.join(pkgDir, "src"), { recursive: true });
		const cli = path.join(pkgDir, "src", "cli.ts");
		fs.writeFileSync(cli, "// cli\n");
		const ompShim = path.join(bunBin, "omp");
		fs.symlinkSync(path.relative(bunBin, cli), ompShim);
		return { ompShim, cli };
	}

	function makeDevTreeRelink(bunBin: string): { ompShim: string; devCli: string } {
		// Layout mimics `omp-relink`:
		//   <tmp>/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent -> <tmp>/dev/packages/coding-agent (symlink)
		//   <tmp>/.bun/bin/omp -> ../install/global/node_modules/@oh-my-pi/pi-coding-agent/src/cli.ts
		const scope = path.join(tmpDir, ".bun", "install", "global", "node_modules", "@oh-my-pi");
		const devPkg = path.join(tmpDir, "dev", "packages", "coding-agent");
		fs.mkdirSync(scope, { recursive: true });
		fs.mkdirSync(path.join(devPkg, "src"), { recursive: true });
		const devCli = path.join(devPkg, "src", "cli.ts");
		fs.writeFileSync(devCli, "// dev cli\n");
		fs.symlinkSync(devPkg, path.join(scope, "pi-coding-agent"));
		const ompShim = path.join(bunBin, "omp");
		fs.symlinkSync(
			path.relative(bunBin, path.join(scope, "pi-coding-agent", "src", "cli.ts")),
			ompShim,
		);
		return { ompShim, devCli };
	}

	it("returns undefined when bun bin dir is unknown", () => {
		const fakeOmp = path.join(tmpDir, "omp");
		fs.writeFileSync(fakeOmp, "");
		expect(_detectDevTreeForTest(fakeOmp, undefined)).toBeUndefined();
	});

	it("returns undefined when omp resolves inside the bun install tree", () => {
		const bunBin = makeBunBinDir();
		const { ompShim } = makeRegistryInstall(bunBin);
		expect(_detectDevTreeForTest(ompShim, bunBin)).toBeUndefined();
	});

	it("returns the dev-tree realpath when the package directory is symlinked outside the bun install tree", () => {
		const bunBin = makeBunBinDir();
		const { ompShim, devCli } = makeDevTreeRelink(bunBin);
		const result = _detectDevTreeForTest(ompShim, bunBin);
		expect(result).toBeDefined();
		expect(fs.realpathSync.native(result!.realPath)).toBe(fs.realpathSync.native(devCli));
	});

	it("returns undefined when the omp shim cannot be realpathed", () => {
		const bunBin = makeBunBinDir();
		expect(_detectDevTreeForTest(path.join(bunBin, "omp-missing"), bunBin)).toBeUndefined();
	});
});
