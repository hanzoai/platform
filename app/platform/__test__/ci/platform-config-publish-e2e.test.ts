import {
	parsePlatformConfig,
	PlatformConfigError,
} from "@hanzo/platform/services/ci/platform-config";
import { describe, expect, it } from "vitest";

/**
 * The `e2e:` and `publish:` blocks are the test + publish legs of the pipeline.
 * They are optional and orthogonal to build/deploy; these tests pin the parser
 * contract so a malformed block fails loud rather than silently skipping a
 * stage.
 */
describe("platform-config e2e block", () => {
	const base = `
build:
  matrix: [{ os: linux, arch: amd64 }]
  image: ghcr.io/hanzoai/x
`;

	it("parses a full e2e block", () => {
		const cfg = parsePlatformConfig(
			`${base}e2e:\n  spec: tests/smoke.spec.ts\n  baseDomain: x.hanzo.ai\n  ref: main\n`,
		);
		expect(cfg.e2e).toEqual({
			spec: "tests/smoke.spec.ts",
			baseDomain: "x.hanzo.ai",
			ref: "main",
		});
	});

	it("defaults baseDomain/ref to undefined when omitted", () => {
		const cfg = parsePlatformConfig(`${base}e2e:\n  spec: tests/health.spec.ts\n`);
		expect(cfg.e2e).toEqual({
			spec: "tests/health.spec.ts",
			baseDomain: undefined,
			ref: undefined,
		});
	});

	it("requires spec", () => {
		expect(() => parsePlatformConfig(`${base}e2e:\n  ref: main\n`)).toThrow(
			PlatformConfigError,
		);
	});

	it("leaves e2e undefined when the block is absent", () => {
		expect(parsePlatformConfig(base).e2e).toBeUndefined();
	});
});

describe("platform-config publish block", () => {
	const base = `
build:
  matrix: [{ os: linux, arch: amd64 }]
  image: ghcr.io/hanzoai/x
`;

	it("parses npm publish with defaults", () => {
		const cfg = parsePlatformConfig(`${base}publish:\n  npm: true\n`);
		expect(cfg.publish).toEqual({
			npm: true,
			pypi: false,
			cargo: false,
			cargoCrates: [],
			packageDir: ".",
			dryRun: false,
		});
	});

	it("parses pypi + packageDir + dryRun", () => {
		const cfg = parsePlatformConfig(
			`${base}publish:\n  pypi: true\n  packageDir: sdk/python\n  dryRun: true\n`,
		);
		expect(cfg.publish).toEqual({
			npm: false,
			pypi: true,
			cargo: false,
			cargoCrates: [],
			packageDir: "sdk/python",
			dryRun: true,
		});
	});

	it("parses cargo publish with an ordered workspace crate list", () => {
		const cfg = parsePlatformConfig(
			`${base}publish:\n  cargo: true\n  cargoCrates:\n    - hanzo-kernels\n    - hanzo-ml\n`,
		);
		expect(cfg.publish).toEqual({
			npm: false,
			pypi: false,
			cargo: true,
			cargoCrates: ["hanzo-kernels", "hanzo-ml"],
			packageDir: ".",
			dryRun: false,
		});
	});

	it("allows both npm and pypi", () => {
		const cfg = parsePlatformConfig(
			`${base}publish:\n  npm: true\n  pypi: true\n`,
		);
		expect(cfg.publish?.npm).toBe(true);
		expect(cfg.publish?.pypi).toBe(true);
	});

	it("rejects a publish block with no target", () => {
		expect(() =>
			parsePlatformConfig(`${base}publish:\n  dryRun: true\n`),
		).toThrow(/at least one of npm: true, pypi: true or cargo: true/);
	});

	it("rejects a non-boolean npm flag", () => {
		expect(() =>
			parsePlatformConfig(`${base}publish:\n  npm: "yes"\n`),
		).toThrow(PlatformConfigError);
	});

	it("leaves publish undefined when the block is absent", () => {
		expect(parsePlatformConfig(base).publish).toBeUndefined();
	});
});
