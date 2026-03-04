import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DRIZZLE_DIR = path.resolve(__dirname, "../../drizzle");
const JOURNAL_PATH = path.join(DRIZZLE_DIR, "meta/_journal.json");

interface JournalEntry {
	idx: number;
	version: string;
	when: number;
	tag: string;
	breakpoints: boolean;
}

interface Journal {
	version: string;
	dialect: string;
	entries: JournalEntry[];
}

function loadJournal(): Journal {
	return JSON.parse(fs.readFileSync(JOURNAL_PATH, "utf-8"));
}

describe("drizzle migration ordering", () => {
	const journal = loadJournal();

	it("sequential indices with no gaps", () => {
		for (let i = 0; i < journal.entries.length; i++) {
			expect(journal.entries[i].idx).toBe(i);
		}
	});

	it("no duplicate indices", () => {
		const indices = journal.entries.map((e) => e.idx);
		expect(new Set(indices).size).toBe(indices.length);
	});

	it("no duplicate tags", () => {
		const tags = journal.entries.map((e) => e.tag);
		expect(new Set(tags).size).toBe(tags.length);
	});

	it("every journal entry has a .sql file", () => {
		for (const entry of journal.entries) {
			const sqlPath = path.join(DRIZZLE_DIR, `${entry.tag}.sql`);
			expect(fs.existsSync(sqlPath), `missing: ${entry.tag}.sql`).toBe(true);
		}
	});

	it("every numbered .sql file has a journal entry", () => {
		const journalTags = new Set(journal.entries.map((e) => e.tag));
		const sqlFiles = fs
			.readdirSync(DRIZZLE_DIR)
			.filter((f) => f.endsWith(".sql") && /^\d{4}_/.test(f));

		for (const file of sqlFiles) {
			const tag = file.replace(/\.sql$/, "");
			expect(journalTags.has(tag), `orphan: ${file}`).toBe(true);
		}
	});

	it("hanzo_rebrand at index 149 with idempotent column creation", () => {
		const entry = journal.entries.find((e) => e.tag === "0149_hanzo_rebrand");
		expect(entry).toBeDefined();
		expect(entry!.idx).toBe(149);

		const sql = fs.readFileSync(
			path.join(DRIZZLE_DIR, "0149_hanzo_rebrand.sql"),
			"utf-8",
		);
		expect(sql).toContain("IF NOT EXISTS");
		expect(sql).toContain("whitelabelingConfig");
	});

	it("futuristic_bullseye at index 148", () => {
		const entry = journal.entries.find(
			(e) => e.tag === "0148_futuristic_bullseye",
		);
		expect(entry).toBeDefined();
		expect(entry!.idx).toBe(148);
	});

	it("tags match their file prefix numbers", () => {
		for (const entry of journal.entries) {
			const prefix = entry.tag.split("_")[0];
			const expected = String(entry.idx).padStart(4, "0");
			expect(prefix, `tag ${entry.tag} prefix != idx ${entry.idx}`).toBe(
				expected,
			);
		}
	});
});
