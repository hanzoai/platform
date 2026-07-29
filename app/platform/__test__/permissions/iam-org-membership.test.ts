import type { ServerSession } from "@hanzo/iam/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Stage 2 (IAM_MIGRATION.md): org membership derives from IAM access-token
 * claims, not Better Auth's organization plugin. These tests lock the bridge
 * contract — `syncIamOrgMembership` must populate the platform
 * `organization`/`member` graph so `activeOrganizationId` is never empty (the
 * root cause of the "no permission to view deployments" 401s), and a global
 * admin must own every org.
 */

// In-memory org/member store the db mock reads/writes. Reset per test.
type OrgRow = { id: string; name: string; slug: string; ownerId: string };
type MemberRow = {
	id: string;
	userId: string;
	organizationId: string;
	role: string;
};
let orgs: OrgRow[] = [];
let members: MemberRow[] = [];
let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

// Minimal drizzle-shaped mock: the module under test uses
// db.query.organization.findFirst/findMany, db.query.member.findFirst,
// db.insert(...).values(...).onConflictDoNothing(...).returning(),
// db.update(...).set(...).where(...).
const orgTableMarker = { __t: "organization" };
const memberTableMarker = { __t: "member" };

vi.mock("@hanzo/platform/db/schema", () => ({
	organization: { ...orgTableMarker, slug: "slug", id: "id" },
	member: { ...memberTableMarker, id: "id", userId: "userId" },
}));

vi.mock("drizzle-orm", () => ({
	// We don't evaluate predicates; the mock filters by recorded intent instead.
	eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
	and: (...conds: unknown[]) => ({ op: "and", conds }),
}));

vi.mock("@hanzo/platform/db", () => {
	const findFirstOrg = (where: any): OrgRow | undefined => {
		// matches eq(organization.slug, X)
		const slug = where?.val;
		return orgs.find((o) => o.slug === slug);
	};
	const findFirstMember = (where: any): MemberRow | undefined => {
		const conds = where?.conds ?? [];
		const userId = conds.find((c: any) => c.col === "userId")?.val;
		// organizationId predicate uses the literal column object; match by value
		const orgId = conds.find((c: any) => c.col !== "userId")?.val;
		return members.find(
			(m) => m.userId === userId && m.organizationId === orgId,
		);
	};

	const insert = (table: any) => ({
		values: (vals: any) => {
			const apply = () => {
				if (table.__t === "organization") {
					if (orgs.find((o) => o.slug === vals.slug)) return [];
					const row: OrgRow = {
						id: nextId("org"),
						name: vals.name,
						slug: vals.slug,
						ownerId: vals.ownerId,
					};
					orgs.push(row);
					return [row];
				}
				// member
				if (
					members.find(
						(m) =>
							m.userId === vals.userId &&
							m.organizationId === vals.organizationId,
					)
				)
					return [];
				const row: MemberRow = {
					id: nextId("member"),
					userId: vals.userId,
					organizationId: vals.organizationId,
					role: vals.role,
				};
				members.push(row);
				return [row];
			};
			const chain = {
				onConflictDoNothing: () => chain,
				returning: () => Promise.resolve(apply()),
				then: (res: (v: unknown) => void) => res(apply()),
			};
			return chain;
		},
	});

	const update = (table: any) => ({
		set: (vals: any) => ({
			where: (where: any) => {
				if (table.__t === "member") {
					const id = where?.val;
					const m = members.find((x) => x.id === id);
					if (m && typeof vals.role === "string") m.role = vals.role;
				}
				return Promise.resolve();
			},
		}),
	});

	return {
		db: {
			insert,
			update,
			query: {
				organization: {
					findFirst: ({ where }: any) => Promise.resolve(findFirstOrg(where)),
					findMany: () => Promise.resolve([...orgs]),
				},
				member: {
					findFirst: ({ where }: any) =>
						Promise.resolve(findFirstMember(where)),
				},
			},
		},
	};
});

const { syncIamOrgMembership, isGlobalAdmin, resolveOwnerOrg } = await import(
	"@hanzo/platform/lib/iam-org"
);

const session = (over: Partial<ServerSession> = {}): ServerSession => ({
	userId: "hanzo/alice",
	owner: "hanzo",
	email: "alice@hanzo.ai",
	claims: { sub: "hanzo/alice", owner: "hanzo" } as ServerSession["claims"],
	...over,
});

beforeEach(() => {
	orgs = [];
	members = [];
	seq = 0;
});

describe("isGlobalAdmin", () => {
	it("true when the isGlobalAdmin claim is set", () => {
		expect(
			isGlobalAdmin(session({ claims: { isGlobalAdmin: true } as any })),
		).toBe(true);
	});
	it("true when owned by the reserved admin org (via owner claim)", () => {
		expect(
			isGlobalAdmin(session({ claims: { owner: "admin" } as any })),
		).toBe(true);
	});
	it("false for an org admin (isAdmin is org-scoped, not global)", () => {
		expect(
			isGlobalAdmin(session({ claims: { owner: "hanzo", isAdmin: true } as any })),
		).toBe(false);
	});
	it("uses claims.owner over the SDK fallback when sub is a UUID", () => {
		// Real IAM user token: UUID sub → SDK owner falls back to 'unknown';
		// the true org is only in claims.owner.
		expect(
			resolveOwnerOrg(
				session({
					userId: "uuid-1234",
					owner: "unknown",
					claims: { sub: "uuid-1234", owner: "hanzo" } as any,
				}),
			),
		).toBe("hanzo");
	});
	it("false for an ordinary org user", () => {
		expect(isGlobalAdmin(session())).toBe(false);
	});
});

describe("syncIamOrgMembership — ordinary user", () => {
	it("creates the home org and an owner membership, returning a non-empty active org", async () => {
		const res = await syncIamOrgMembership(session(), "hanzo/alice");
		expect(res.activeOrganizationId).not.toBe("");
		expect(orgs).toHaveLength(1);
		expect(orgs[0]?.slug).toBe("hanzo");
		expect(members).toHaveLength(1);
		expect(members[0]).toMatchObject({
			userId: "hanzo/alice",
			organizationId: res.activeOrganizationId,
			role: "owner",
		});
	});

	it("is idempotent — a second sync neither duplicates the org nor the membership", async () => {
		await syncIamOrgMembership(session(), "hanzo/alice");
		await syncIamOrgMembership(session(), "hanzo/alice");
		expect(orgs).toHaveLength(1);
		expect(members).toHaveLength(1);
	});

	it("does NOT grant membership in other orgs", async () => {
		// pre-existing foreign org
		orgs.push({ id: "org-x", name: "zoo", slug: "zoo", ownerId: "zoo/z" });
		await syncIamOrgMembership(session(), "hanzo/alice");
		expect(members.some((m) => m.organizationId === "org-x")).toBe(false);
	});

	it("fails closed on an empty owner claim (never keys an org on \"\")", async () => {
		await expect(
			syncIamOrgMembership(
				session({ owner: "", claims: { sub: "x" } as any }),
				"hanzo/alice",
			),
		).rejects.toThrow(/owner/i);
		expect(orgs).toHaveLength(0);
		expect(members).toHaveLength(0);
	});
});

describe("syncIamOrgMembership — global admin manages every org", () => {
	it("owns every known org", async () => {
		orgs.push(
			{ id: "org-zoo", name: "zoo", slug: "zoo", ownerId: "zoo/z" },
			{ id: "org-lux", name: "lux", slug: "lux", ownerId: "lux/z" },
		);
		const res = await syncIamOrgMembership(
			session({ owner: "hanzo", claims: { isGlobalAdmin: true } as any }),
			"hanzo/z",
		);
		// home org (hanzo) created + the two pre-existing orgs => 3 owner rows
		const owned = members.filter(
			(m) => m.userId === "hanzo/z" && m.role === "owner",
		);
		expect(owned).toHaveLength(3);
		expect(res.activeOrganizationId).toBe(
			orgs.find((o) => o.slug === "hanzo")?.id,
		);
		for (const o of orgs) {
			expect(
				members.some(
					(m) =>
						m.userId === "hanzo/z" &&
						m.organizationId === o.id &&
						m.role === "owner",
				),
			).toBe(true);
		}
	});

	it("promotes an existing member-role to owner for a global admin", async () => {
		orgs.push({ id: "org-zoo", name: "zoo", slug: "zoo", ownerId: "zoo/z" });
		members.push({
			id: "m-existing",
			userId: "hanzo/z",
			organizationId: "org-zoo",
			role: "member",
		});
		await syncIamOrgMembership(
			session({ claims: { isGlobalAdmin: true } as any }),
			"hanzo/z",
		);
		expect(members.find((m) => m.id === "m-existing")?.role).toBe("owner");
	});
});
