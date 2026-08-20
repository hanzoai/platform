import { describe, expect, it } from "vitest";

import { buildArgsProblem } from "../../server/v1/build-request";

/**
 * A build arg key is spliced into `--opt=build-arg:<key>=<value>`, so a key that
 * is not an ARG name would build a different option than it reads like. Values
 * are free text: they ride as their own argv element and never reach a shell.
 */
describe("buildArgsProblem", () => {
	it("accepts an absent field and a flat string map", () => {
		expect(buildArgsProblem(undefined)).toBeNull();
		expect(buildArgsProblem({})).toBeNull();
		expect(
			buildArgsProblem({ VERSION: "v1.34.1", GO_TAGS: "netgo osusergo" }),
		).toBeNull();
	});

	it("refuses anything that is not an object of strings", () => {
		expect(buildArgsProblem("VERSION=1")).toContain("must be an object");
		expect(buildArgsProblem(["VERSION=1"])).toContain("must be an object");
		expect(buildArgsProblem(null)).toContain("must be an object");
		expect(buildArgsProblem({ VERSION: 1 })).toContain("must be a string");
	});

	it("refuses a key that is not a Dockerfile ARG name", () => {
		for (const k of ["VER SION", "A=B", "--opt=target", "1VERSION", ""]) {
			expect(buildArgsProblem({ [k]: "x" }), k).toContain("ARG name");
		}
	});
});
