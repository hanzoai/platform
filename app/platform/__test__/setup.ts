import { vi } from "vitest";

/**
 * Mock the DB module so tests that import from @hanzo/platform (barrel)
 * never open a real TCP connection to PostgreSQL (e.g. in CI where no DB runs).
 * Without this, loading the server barrel pulls in lib/auth and db, which
 * connect to localhost:5432 and cause ECONNREFUSED.
 */
vi.mock("@hanzo/platform/db", async () => {
	// The barrel re-exports drizzle's `and`/`eq` alongside `db` (index.ts:12).
	// They are PURE query-expression builders — no connection — so the mock hands
	// back the real ones instead of stubs; a mocked module replaces the WHOLE
	// module, and omitting them makes every `where(eq(...))` throw "No export".
	const { and, eq } = await import("drizzle-orm");
	const chain = () => chain;
	chain.set = () => chain;
	chain.where = () => chain;
	chain.values = () => chain;
	chain.returning = () => Promise.resolve([{}]);
	chain.from = () => chain;
	chain.innerJoin = () => chain;
	chain.limit = () => chain;
	chain.onConflictDoNothing = () => chain;
	// better-sqlite3 drizzle terminates a write with `.run()` (the Postgres
	// driver awaited the builder directly). Without it, any code path that
	// actually writes throws `.run is not a function` inside the mock.
	chain.run = () => chain;
	chain.then = (resolve: (value: unknown) => void) => {
		resolve([]);
	};

	const tableMock = {
		findFirst: vi.fn(() => Promise.resolve(undefined)),
		findMany: vi.fn(() => Promise.resolve([])),
		insert: vi.fn(() => Promise.resolve([{}])),
		update: vi.fn(() => chain),
		delete: vi.fn(() => chain),
	};

	return {
		db: {
			select: vi.fn(() => chain),
			insert: vi.fn(() => ({
				values: () => ({
					returning: () => Promise.resolve([{}]),
					onConflictDoNothing: () => ({
						returning: () => Promise.resolve([{}]),
					}),
				}),
			})),
			update: vi.fn(() => chain),
			delete: vi.fn(() => chain),
			query: new Proxy({} as Record<string, typeof tableMock>, {
				get: () => tableMock,
			}),
		},
		dbUrl: "postgres://mock:mock@localhost:5432/mock",
		and,
		eq,
	};
});
