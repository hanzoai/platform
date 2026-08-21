import { describe, expect, it } from "vitest";
import { parseBuildFailure } from "../../../../pkg/platform/src/services/ci/buildkit-job";

/**
 * Every failed build in the estate recorded the same sentence — "BuildKit Job
 * <name> failed (backoff exhausted)" — and nothing else: 436 failures, 0 with
 * logs. The one real cause anyone recovered (an UNRESOLVED_IMPORT that pinned
 * luxfi/exchange two tags behind) had to be found by re-running the build to
 * catch a live pod before k8s garbage-collected it.
 *
 * The fixtures below are real BuildKit output from that failure.
 */
const REAL_UNRESOLVED_IMPORT = `
#49 6.486 ✓ 11475 modules transformed.
#49 6.490 ✗ Build failed in 4.17s
#49 6.491 error during build:
#49 6.491 Build failed with 1 error:
#49 6.491 [UNRESOLVED_IMPORT] Error: Could not resolve './LxGeneric' in ../../pkgs/ui/src/components/icons/exported.ts
#49 6.491     at aggregateBindingErrorsIntoJsError (file:///app/node_modules/.pnpm/rolldown@1.0.0-rc.15/error.mjs:48:18)
#49 ERROR: process "/bin/sh -c cd apps/web && pnpm exec vite build" did not complete successfully: exit code: 1
error: failed to solve: process "/bin/sh -c cd apps/web && pnpm exec vite build" did not complete successfully: exit code: 1
`;

describe("parseBuildFailure", () => {
	it("prefers the real cause over the trailing solve error", () => {
		const out = parseBuildFailure(REAL_UNRESOLVED_IMPORT);
		expect(out).toContain("UNRESOLVED_IMPORT");
		expect(out).toContain("./LxGeneric");
		// `error: failed to solve:` is the least useful of the three and must not win.
		expect(out).not.toMatch(/^error: failed to solve/);
	});

	it("strips the BuildKit step/timestamp prefix", () => {
		expect(parseBuildFailure(REAL_UNRESOLVED_IMPORT)).not.toMatch(/^#\d+/);
	});

	it("falls back to ERROR: when there is no bracketed code", () => {
		const log = `#12 0.5 building\n#12 ERROR: process "/bin/sh -c go build ./..." did not complete successfully: exit code: 2\n`;
		expect(parseBuildFailure(log)).toContain("did not complete successfully");
	});

	it("falls back to the last error-ish line when nothing matches", () => {
		const log = "step one ok\nsomething went wrong: permission denied\nbye\n";
		expect(parseBuildFailure(log)).toContain("permission denied");
	});

	it("returns undefined for a log with no error at all", () => {
		expect(parseBuildFailure("#1 done\n#2 done\n")).toBeUndefined();
	});

	it("bounds the returned detail so one failure cannot flood the column", () => {
		const long = `#1 0.1 [FATAL_ERROR] Error: ${"x".repeat(5000)}`;
		expect((parseBuildFailure(long) ?? "").length).toBeLessThanOrEqual(400);
	});
});
