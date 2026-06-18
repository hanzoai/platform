/**
 * arcd runner registry — the OWNERSHIP + management surface
 * (/v1/platform/runners), driven through the real route handler.
 *
 * Exercises register (with an explicit org, and without → secret minted),
 * list (org-scoped vs the admin global view), and revoke (org-scoped). The
 * real registerRunner / listRunners / revokeRunner service logic runs against
 * an in-memory store standing in for Postgres — mirroring
 * arcd-longpoll.integration.test.ts. The IAM session seam (`validateRequest`)
 * is the other mocked boundary, since the route does not own auth.
 *
 * Routing is deliberately NOT here: ownership never touches dispatch.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── In-memory store standing in for Postgres ──────────────────────────────
// vi.hoisted so the vi.mock factories (hoisted above the imports) close over
// the same store the test body inspects.
const mem = vi.hoisted(() => {
	interface Row {
		[k: string]: unknown;
	}
	const store = { arcd_runner: new Map<string, Row>() };

	// Drizzle column/where surrogates. fakeEq/fakeIsNull build structural
	// predicates the fake query layer evaluates; undefined `where` means "all".
	interface Pred {
		__col: string;
		__op: "eq" | "isNull";
		__val?: unknown;
	}
	const fakeEq = (col: { name: string }, val: unknown): Pred => ({
		__col: col.name,
		__op: "eq",
		__val: val,
	});
	const fakeIsNull = (col: { name: string }): Pred => ({
		__col: col.name,
		__op: "isNull",
	});
	const match = (r: Row, p: Pred): boolean =>
		p.__op === "isNull" ? r[p.__col] == null : r[p.__col] === p.__val;

	const db = {
		insert(_table: unknown) {
			return {
				values(input: Row) {
					// $defaultFn (createdAt) runs in the real driver; synthesize it so
					// the in-memory store behaves like Postgres.
					const v: Row = { ...input };
					if (v.createdAt === undefined) v.createdAt = new Date().toISOString();
					const apply = (onConflictSet?: Row) => {
						const id = String(v.runnerId);
						const existing = store.arcd_runner.get(id);
						const next = existing
							? { ...existing, ...(onConflictSet ?? v) }
							: { ...v };
						store.arcd_runner.set(id, next);
						return next;
					};
					return {
						onConflictDoUpdate: (arg: { set: Row }) => ({
							returning: async () => [apply(arg.set)],
						}),
						returning: async () => [apply()],
					};
				},
			};
		},
		delete(_table: unknown) {
			return {
				where(p: Pred) {
					const removed: Row[] = [];
					for (const [id, r] of store.arcd_runner) {
						if (match(r, p)) {
							removed.push(r);
							store.arcd_runner.delete(id);
						}
					}
					return {
						returning: async () => removed,
						then: (resolve: (v: unknown) => void) => resolve(removed),
					};
				},
			};
		},
		query: {
			arcdRunner: {
				findFirst: async ({ where }: { where: Pred }) =>
					[...store.arcd_runner.values()].find((r) => match(r, where)),
				findMany: async (arg?: { where?: Pred }) => {
					const rows = [...store.arcd_runner.values()];
					return arg?.where ? rows.filter((r) => match(r, arg.where as Pred)) : rows;
				},
			},
		},
	};

	return { store, db, fakeEq, fakeIsNull };
});

const store = mem.store;

vi.mock("@hanzo/platform/db", () => ({
	db: mem.db,
	eq: mem.fakeEq,
	dbUrl: "postgres://mock/mock",
}));

vi.mock("drizzle-orm", () => ({ isNull: mem.fakeIsNull }));

// Schema: structural surrogate carrying the columns the service touches, plus
// the real-shaped register zod schema (organizationId nullish).
vi.mock("@hanzo/platform/db/schema", async () => {
	const { z } = await import("zod");
	const col = (name: string) => ({ name });
	return {
		arcdRunner: {
			name: "arcd_runner",
			runnerId: col("runnerId"),
			poolLabel: col("poolLabel"),
			organizationId: col("organizationId"),
		},
		apiRegisterArcdRunner: z.object({
			runnerId: z.string().min(1),
			poolLabel: z.string().min(1),
			secret: z.string().min(32),
			organizationId: z.string().min(1).nullish(),
		}),
	};
});

// IAM session seam. The test swaps the resolved principal per case.
const session = vi.hoisted(() => ({
	current: null as
		| { activeOrganizationId: string | null; role: string }
		| null,
}));
vi.mock("@hanzo/platform", () => ({
	validateRequest: async () =>
		session.current
			? {
					session: { activeOrganizationId: session.current.activeOrganizationId },
					user: { role: session.current.role },
				}
			: { session: null, user: null },
}));

const ORG_A = "org_aaa";
const ORG_B = "org_bbb";

function asTenant(orgId: string) {
	session.current = { activeOrganizationId: orgId, role: "member" };
}
function asAdmin(orgId: string) {
	session.current = { activeOrganizationId: orgId, role: "owner" };
}

// ── Fake Next req/res ─────────────────────────────────────────────────────
function makeReq(
	method: string,
	opts: { body?: unknown; query?: Record<string, string> } = {},
): any {
	return { method, body: opts.body, query: opts.query ?? {} };
}
function makeRes(): {
	statusCode: number;
	body: unknown;
	ended: boolean;
	headers: Record<string, unknown>;
} & any {
	const res: any = {
		statusCode: 0,
		body: undefined,
		ended: false,
		headers: {},
		status(code: number) {
			this.statusCode = code;
			return this;
		},
		json(payload: unknown) {
			this.body = payload;
			this.ended = true;
			return this;
		},
		end() {
			this.ended = true;
			return this;
		},
		setHeader(k: string, v: unknown) {
			this.headers[k] = v;
		},
	};
	return res;
}

// Import AFTER mocks are registered.
const { default: handler } = await import(
	"../../pages/api/v1/platform/runners"
);

beforeEach(() => {
	store.arcd_runner.clear();
	session.current = null;
});

describe("runner registry — register", () => {
	it("rejects an unauthenticated caller", async () => {
		const res = makeRes();
		await handler(
			makeReq("POST", { body: { runnerId: "evo-1", poolLabel: "p" } }),
			res,
		);
		expect(res.statusCode).toBe(401);
	});

	it("registers a tenant runner under the caller's org when org is omitted", async () => {
		asTenant(ORG_A);
		const res = makeRes();
		await handler(
			makeReq("POST", { body: { runnerId: "evo-1", poolLabel: "hanzoai-linux-amd64" } }),
			res,
		);
		expect(res.statusCode).toBe(201);
		const row = res.body as any;
		expect(row.runnerId).toBe("evo-1");
		expect(row.organizationId).toBe(ORG_A);
		// Secret minted (48 hex chars = 24 bytes) and returned exactly once.
		expect(row.secret).toMatch(/^[0-9a-f]{48}$/);
		expect(store.arcd_runner.get("evo-1")?.organizationId).toBe(ORG_A);
	});

	it("honors an explicitly provided secret", async () => {
		asTenant(ORG_A);
		const secret = "0123456789abcdef0123456789abcdef0123456789abcdef";
		const res = makeRes();
		await handler(
			makeReq("POST", {
				body: { runnerId: "evo-1", poolLabel: "p-amd64", secret },
			}),
			res,
		);
		expect(res.statusCode).toBe(201);
		expect((res.body as any).secret).toBe(secret);
	});

	it("lets a platform-admin mint a SHARED runner (organizationId=null)", async () => {
		asAdmin(ORG_A);
		const res = makeRes();
		await handler(
			makeReq("POST", {
				body: { runnerId: "shared-1", poolLabel: "p-amd64", organizationId: null },
			}),
			res,
		);
		expect(res.statusCode).toBe(201);
		expect((res.body as any).organizationId).toBeNull();
		expect(store.arcd_runner.get("shared-1")?.organizationId).toBeNull();
	});

	it("forbids a tenant from registering a runner for another org", async () => {
		asTenant(ORG_A);
		const res = makeRes();
		await handler(
			makeReq("POST", {
				body: { runnerId: "evo-1", poolLabel: "p", organizationId: ORG_B },
			}),
			res,
		);
		expect(res.statusCode).toBe(403);
	});

	it("forbids a tenant from re-registering a runnerId owned by another org", async () => {
		store.arcd_runner.set("evo-1", {
			runnerId: "evo-1",
			poolLabel: "p",
			secret: "x".repeat(48),
			organizationId: ORG_B,
		});
		asTenant(ORG_A);
		const res = makeRes();
		await handler(
			makeReq("POST", { body: { runnerId: "evo-1", poolLabel: "p" } }),
			res,
		);
		expect(res.statusCode).toBe(403);
	});

	it("rejects a malformed body", async () => {
		asTenant(ORG_A);
		const res = makeRes();
		await handler(makeReq("POST", { body: { poolLabel: "p" } }), res);
		expect(res.statusCode).toBe(400);
	});
});

describe("runner registry — list", () => {
	beforeEach(() => {
		store.arcd_runner.set("a1", {
			runnerId: "a1",
			poolLabel: "p",
			secret: "x".repeat(48),
			organizationId: ORG_A,
		});
		store.arcd_runner.set("b1", {
			runnerId: "b1",
			poolLabel: "p",
			secret: "x".repeat(48),
			organizationId: ORG_B,
		});
		store.arcd_runner.set("shared", {
			runnerId: "shared",
			poolLabel: "p",
			secret: "x".repeat(48),
			organizationId: null,
		});
	});

	it("scopes a tenant to their own org's runners", async () => {
		asTenant(ORG_A);
		const res = makeRes();
		await handler(makeReq("GET"), res);
		expect(res.statusCode).toBe(200);
		const ids = (res.body as any[]).map((r) => r.runnerId).sort();
		expect(ids).toEqual(["a1"]);
	});

	it("shows an admin every runner including shared", async () => {
		asAdmin(ORG_A);
		const res = makeRes();
		await handler(makeReq("GET"), res);
		expect(res.statusCode).toBe(200);
		const ids = (res.body as any[]).map((r) => r.runnerId).sort();
		expect(ids).toEqual(["a1", "b1", "shared"]);
	});
});

describe("runner registry — revoke", () => {
	beforeEach(() => {
		store.arcd_runner.set("a1", {
			runnerId: "a1",
			poolLabel: "p",
			secret: "x".repeat(48),
			organizationId: ORG_A,
		});
		store.arcd_runner.set("b1", {
			runnerId: "b1",
			poolLabel: "p",
			secret: "x".repeat(48),
			organizationId: ORG_B,
		});
	});

	it("revokes the caller's own runner", async () => {
		asTenant(ORG_A);
		const res = makeRes();
		await handler(makeReq("DELETE", { query: { runnerId: "a1" } }), res);
		expect(res.statusCode).toBe(204);
		expect(store.arcd_runner.has("a1")).toBe(false);
	});

	it("forbids a tenant revoking another org's runner", async () => {
		asTenant(ORG_A);
		const res = makeRes();
		await handler(makeReq("DELETE", { query: { runnerId: "b1" } }), res);
		expect(res.statusCode).toBe(403);
		expect(store.arcd_runner.has("b1")).toBe(true);
	});

	it("lets an admin revoke any org's runner", async () => {
		asAdmin(ORG_A);
		const res = makeRes();
		await handler(makeReq("DELETE", { query: { runnerId: "b1" } }), res);
		expect(res.statusCode).toBe(204);
		expect(store.arcd_runner.has("b1")).toBe(false);
	});

	it("404s an unknown runner", async () => {
		asTenant(ORG_A);
		const res = makeRes();
		await handler(makeReq("DELETE", { query: { runnerId: "nope" } }), res);
		expect(res.statusCode).toBe(404);
	});

	it("400s a missing runnerId", async () => {
		asTenant(ORG_A);
		const res = makeRes();
		await handler(makeReq("DELETE"), res);
		expect(res.statusCode).toBe(400);
	});
});
