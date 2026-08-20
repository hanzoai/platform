import { describe, expect, it } from "vitest";
import { e2eScript } from "@hanzo/platform/services/ci/e2e-runner";

describe("e2eScript", () => {
	it("clones the canonical universe from the forge", () => {
		const s = e2eScript();
		expect(s).toContain(
			'"https://x-access-token:${GIT_AUTH_TOKEN}@git.hanzo.ai/hanzo/universe.git" universe',
		);
		expect(s).not.toContain("github.com");
	});

	it("runs the requested spec from the e2e workspace", () => {
		const s = e2eScript();
		expect(s).toContain("set -euo pipefail");
		expect(s).toContain("cd universe/e2e");
		expect(s).toContain('npx playwright test "$E2E_SPEC" --reporter=line');
	});
});
