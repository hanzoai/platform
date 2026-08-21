/**
 * The ref rule, checked against git itself.
 *
 * `nameProblem` exists to say what git would say, so the way to know it is
 * right is to ask git. Two questions, because a name has to pass both to be a
 * ref somebody pushed:
 *
 *   1. Is it a well-formed name? `git check-ref-format` is that rule, and it is
 *      the one git applies the moment a ref is created.
 *   2. Can git store it? A loose ref is a file at the name's path, written
 *      through a sibling `<name>.lock`, so each component has to fit in a
 *      directory entry. That is a bound on a COMPONENT and never on the name.
 *
 * Asking git rather than restating it is what keeps the rule honest in both
 * directions. Too loose admits a name the forge cannot hold; too tight refuses
 * a branch somebody is really pushing, and a refusal of a real branch is an
 * outage that looks like a security control.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refProblem } from "@hanzo/platform/services/hanzo-git";
import { describe, expect, it } from "vitest";

/**
 * Ask git which of these whole refnames it considers well-formed.
 *
 * One shell, one `git` per name, answers read back positionally. Names travel
 * through a NUL-delimited file rather than an argument list or lines: a sweep
 * over codepoints necessarily contains U+000A, and a line-delimited list would
 * quietly read that one name as two.
 */
function wellFormed(refs: readonly string[]): boolean[] {
	const dir = mkdtempSync(join(tmpdir(), "refrule-"));
	const list = join(dir, "names");
	writeFileSync(list, refs.map((r) => `${r}\0`).join(""));
	const out = execFileSync(
		"bash",
		[
			"-c",
			`while IFS= read -r -d '' r; do if git check-ref-format "$r" 2>/dev/null; then echo 1; else echo 0; fi; done < "${list}"`,
		],
		{ encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
	);
	const answers = out.trim().split("\n");
	expect(answers).toHaveLength(refs.length);
	return answers.map((a) => a === "1");
}

/** A scratch repository with one commit, for asking whether a branch is makeable. */
function repo(): string {
	const dir = mkdtempSync(join(tmpdir(), "refrepo-"));
	const git = (...args: string[]) =>
		execFileSync("git", args, { cwd: dir, stdio: "ignore" });
	git("init", "-q", "-b", "main");
	git("config", "user.email", "t@t");
	git("config", "user.name", "t");
	writeFileSync(join(dir, "f"), "x");
	git("add", "f");
	git("commit", "-qm", "c");
	return dir;
}

/** Does git actually create this branch here? */
function makeable(dir: string, name: string): boolean {
	try {
		execFileSync("git", ["branch", name], { cwd: dir, stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

/** What our rule says about a name, as a boolean in git's direction. */
function accepts(name: string): boolean {
	return refProblem(`refs/heads/${name}`) === null;
}

/**
 * Names built to sit on every edge of the rule: each refused character and
 * sequence, each one moved to a component boundary, and the ordinary shapes a
 * person or a bot actually pushes.
 */
function structured(): string[] {
	const names: string[] = [
		"main",
		"@",
		"@@",
		"x/@",
		"@/x",
		"a@b",
		"a@",
		"HEAD",
		"feature/a-b_c.d",
		"release/2026.1",
		"-dash",
		"UPPER",
		"a.b",
		"a./b",
		"a]b",
		"a%b",
		"a#b",
		"a+b",
		"alock",
		"..",
		"a..b",
		".hidden",
		"nested/.hidden",
		"x.lock",
		"nested/x.lock",
		"a b",
		"a~1",
		"a^",
		"a:b",
		"a?",
		"a*",
		"a[",
		"a\\b",
		"a@{1}",
		"a//b",
		"a/",
		"trailing.",
		"",
		// Deep auto-generated names — the realistic long-name class.
		`renovate/${"monorepo-services-gateway/".repeat(6)}npm-scope-package-1.2.3`,
		`dependabot/npm_and_yarn/${"a".repeat(120)}/${"b".repeat(120)}`,
		// Hierarchical names longer than any one component may be.
		`${"a".repeat(200)}/${"b".repeat(200)}`,
		[1, 2, 3].map(() => "c".repeat(200)).join("/"),
	];
	// Every codepoint through Latin Extended, so both sides of the C0/C1 split
	// and every ASCII punctuation mark are asked about individually; then a
	// stride across the rest, which is where a category-shaped rule would go
	// wrong in bulk if it were going to.
	for (let cp = 1; cp <= 0x2ff; cp++)
		names.push(`a${String.fromCodePoint(cp)}b`);
	for (let cp = 0x300; cp <= 0x2fff; cp += 13) {
		names.push(`a${String.fromCodePoint(cp)}b`);
	}
	return names;
}

describe("the name a ref carries, against git", () => {
	it("answers as git does for every well-formed name", () => {
		const names = structured().filter((n) =>
			// A name whose component git could not store is the second question,
			// asked below; this one is only about the shape of the name.
			n
				.split("/")
				.every((p) => p.length <= 250),
		);
		const refs = names.map((n) => `refs/heads/${n}`);
		const git = wellFormed(refs);

		const disagree = names
			.map((name, i) => ({ name, git: git[i], us: accepts(name) }))
			.filter((r) => r.git !== r.us);

		expect(
			disagree.map(
				(d) =>
					`${JSON.stringify(d.name)}: git ${d.git ? "accepts" : "refuses"}, we ${d.us ? "accept" : "refuse"}`,
			),
		).toEqual([]);
		// One `git` per name, a few thousand of them.
	}, 120_000);

	it("takes the C1 controls git takes, and refuses the C0 controls git refuses", () => {
		// U+0080–U+009F are controls in Unicode and ordinary bytes to git: their
		// UTF-8 encodings start at 0xC2, so nothing in them is below \040.
		for (let cp = 0x80; cp <= 0x9f; cp++) {
			expect(
				accepts(`a${String.fromCodePoint(cp)}b`),
				`U+${cp.toString(16)}`,
			).toBe(true);
		}
		// U+0000–U+001F and U+007F are the bytes git names.
		for (let cp = 1; cp <= 0x1f; cp++) {
			expect(
				accepts(`a${String.fromCodePoint(cp)}b`),
				`U+${cp.toString(16)}`,
			).toBe(false);
		}
		expect(accepts("ab")).toBe(false);
	});

	it("takes a branch named `@`, which git keeps only as a whole refname", () => {
		const dir = repo();
		expect(makeable(dir, "@")).toBe(true);
		expect(refProblem("refs/heads/@")).toBeNull();
		expect(refProblem("refs/tags/@")).toBeNull();
	});

	it("takes a hierarchical name longer than any one component may be", () => {
		const dir = repo();
		const name = `${"a".repeat(200)}/${"b".repeat(200)}`;
		expect(name).toHaveLength(401);
		expect(makeable(dir, name)).toBe(true);
		expect(refProblem(`refs/heads/${name}`)).toBeNull();
	});

	it("caps a component where git itself stops, not the whole name", () => {
		const dir = repo();
		// A loose ref is written through `<name>.lock`, so the longest component
		// git can store is a directory entry less those five bytes.
		expect(makeable(dir, "p".repeat(250))).toBe(true);
		expect(makeable(dir, "q".repeat(251))).toBe(false);
		expect(refProblem(`refs/heads/${"p".repeat(250)}`)).toBeNull();
		expect(refProblem(`refs/heads/${"q".repeat(251)}`)).toMatch(
			/does not name a branch or a tag/i,
		);
		// And the cap is per component: two of them are still fine.
		expect(
			refProblem(`refs/heads/${"p".repeat(250)}/${"r".repeat(250)}`),
		).toBeNull();
	});
});
