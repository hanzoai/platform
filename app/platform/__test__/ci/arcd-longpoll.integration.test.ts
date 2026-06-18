/**
 * Integration: native arcd long-poll, end to end.
 *
 * Spins the real long-poll fabric (`buildQueue`), the real HMAC auth, the real
 * BuildScheduler native path, and the real completion → DeployExecutor handoff,
 * against an in-memory store standing in for Postgres. A local in-process
 * "arcd worker" long-polls exactly as the Go runner does:
 *
 *   register runner → scheduler enqueues a job (native, because the pool has a
 *   live runner) → worker pulls it via buildQueue.wait → worker reports success
 *   via completeBuild → DeployExecutor patches the operator Service CR.
 *
 * The ONLY mocked seams are the external boundaries platform does not own in a
 * unit run: GitHub (`.platform.yml` fetch, provider lookup, octokit) and the
 * Kubernetes client (the operator patch is captured, not sent). The queue is
 * real per the test contract — there is no mock of the queue.
 */
import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── In-memory store standing in for Postgres ──────────────────────────────
// Defined via vi.hoisted so the vi.mock factories (hoisted to the top of the
// module) can close over the same store the test body inspects.
const mem = vi.hoisted(() => {
	interface Row {
		[k: string]: unknown;
	}
	const store = {
		arcd_runner: new Map<string, Row>(),
		build_job: new Map<string, Row>(),
	};

	function tableName(table: unknown): keyof typeof store {
		const n = table as { _?: { name?: string }; name?: string } | undefined;
		const name = n?._?.name ?? n?.name;
		if (name === "arcd_runner" || name === "build_job") return name;
		throw new Error(`unknown table in fake db: ${String(name)}`);
	}

	interface EqExpr {
		__col: string;
		__val: unknown;
	}
	const fakeEq = (col: { name: string }, val: unknown): EqExpr => ({
		__col: col.name,
		__val: val,
	});
	const fakeAnd = (...exprs: EqExpr[]): EqExpr[] => exprs;

	const rowKey = (t: keyof typeof store): string =>
		t === "arcd_runner" ? "runnerId" : "buildJobId";

	const db = {
		insert(table: unknown) {
			const t = tableName(table);
			return {
				values(input: Row) {
					// Drizzle's $defaultFn (nanoid id, createdAt) runs in the real
					// driver, not here — synthesize the primary key + createdAt the
					// services rely on so the in-memory store behaves like Postgres.
					const v: Row = { ...input };
					const key = rowKey(t);
					if (v[key] === undefined) {
						v[key] = `${t}_${Math.random().toString(36).slice(2, 10)}`;
					}
					if (v.createdAt === undefined) v.createdAt = new Date().toISOString();
					// onConflict set is applied ONLY when a row already exists; a
					// fresh insert always lands the full values row.
					const apply = (onConflictSet?: Row) => {
						const id = String(v[rowKey(t)]);
						const existing = store[t].get(id);
						const next = existing
							? { ...existing, ...(onConflictSet ?? v) }
							: { ...v };
						store[t].set(id, next);
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
		update(table: unknown) {
			const t = tableName(table);
			return {
				set: (patch: Row) => ({
					where(expr: EqExpr) {
						const matched = [...store[t].values()].filter(
							(r) => r[expr.__col] === expr.__val,
						);
						for (const r of matched) Object.assign(r, patch);
						return {
							returning: async () => matched,
							then: (resolve: (v: unknown) => void) => resolve(matched),
						};
					},
				}),
			};
		},
		query: {
			arcdRunner: {
				findFirst: async ({ where }: { where: EqExpr }) =>
					[...store.arcd_runner.values()].find(
						(r) => r[where.__col] === where.__val,
					),
				findMany: async ({ where }: { where: EqExpr }) =>
					[...store.arcd_runner.values()].filter(
						(r) => r[where.__col] === where.__val,
					),
			},
			buildJob: {
				findFirst: async ({ where }: { where: EqExpr | EqExpr[] }) => {
					const exprs = Array.isArray(where) ? where : [where];
					return [...store.build_job.values()].find((r) =>
						exprs.every((e) => r[e.__col] === e.__val),
					);
				},
				findMany: async () => [...store.build_job.values()],
			},
		},
	};

	return { store, db, fakeEq, fakeAnd };
});

const store = mem.store;
function resetStore() {
	store.arcd_runner.clear();
	store.build_job.clear();
}

vi.mock("@hanzo/platform/db", () => ({
	db: mem.db,
	eq: mem.fakeEq,
	and: mem.fakeAnd,
	dbUrl: "postgres://mock/mock",
}));

// Schema tables: drizzle column objects expose `.name`; we expose just enough
// for fakeEq/tableName. The real schema's pgTable proxies carry `.name` per
// column and a table-level name, which our fake reads structurally.
vi.mock("@hanzo/platform/db/schema", () => {
	const col = (name: string) => ({ name });
	return {
		arcdRunner: {
			name: "arcd_runner",
			runnerId: col("runnerId"),
			poolLabel: col("poolLabel"),
		},
		buildJob: {
			name: "build_job",
			buildJobId: col("buildJobId"),
			repo: col("repo"),
			sha: col("sha"),
			target: col("target"),
			status: col("status"),
		},
	};
});

// GitHub seam: provider lookup + octokit + .platform.yml fetch.
const PLATFORM_YML = `
build:
  image: ghcr.io/hanzoai/zip
  dockerfile: ./Dockerfile
  context: .
  matrix:
    - { os: linux, arch: amd64 }
deploy:
  on: [main]
  target:
    cluster: hanzo-k8s
    namespace: hanzo
    operator: hanzo
    crd: Service
    name: zip
`;

vi.mock("@hanzo/platform/services/github", () => ({
	findGithubByInstallationId: vi.fn(async () => ({
		githubId: "gh1",
		gitProvider: { organizationId: "org-1" },
	})),
}));

vi.mock("@hanzo/platform/utils/providers/github", () => ({
	authGithub: () => ({
		rest: {
			repos: {
				getContent: async () => ({
					data: {
						content: Buffer.from(PLATFORM_YML, "utf8").toString("base64"),
						encoding: "base64",
					},
				}),
			},
			actions: {
				createWorkflowDispatch: vi.fn(async () => {
					throw new Error(
						"workflow_dispatch must NOT be called on the native path",
					);
				}),
			},
		},
	}),
}));

// Capture the operator patch instead of hitting a cluster.
const cap = vi.hoisted(() => ({
	patchCalls: [] as Array<Record<string, unknown>>,
}));
const patchCalls = cap.patchCalls;
vi.mock("@hanzo/platform/services/k8s/k8s-client", () => ({
	getDefaultClients: () => ({
		custom: {
			patchNamespacedCustomObject: async (req: Record<string, unknown>) => {
				cap.patchCalls.push(req);
				return {};
			},
		},
	}),
}));

// ── System under test (imported AFTER mocks) ──────────────────────────────
import { registerRunner } from "@hanzo/platform/services/ci/arcd-runner";
import { buildQueue } from "@hanzo/platform/services/ci/build-queue";
import { completeBuild } from "@hanzo/platform/services/ci/build-completion";
import { scheduleBuilds } from "@hanzo/platform/services/ci/build-scheduler";

const POOL = "hanzoai-linux-amd64";

describe("arcd native long-poll — integration", () => {
	beforeEach(() => {
		resetStore();
		patchCalls.length = 0;
	});

	it("dispatches → polls → completes → deploys via the native fabric", async () => {
		const t0 = Date.now();

		// 1. A runner self-registers for the pool (this is the migration switch).
		await registerRunner({
			runnerId: "evo-1",
			poolLabel: POOL,
			secret: randomBytes(24).toString("hex"),
		});

		// 2. Start an in-process arcd worker long-polling the pool BEFORE the
		//    job exists, exactly like the Go runner's worker loop.
		const ctrl = new AbortController();
		const pulled = buildQueue.wait(POOL, ctrl.signal);

		// 3. Webhook → scheduler. Pool has a live runner ⇒ native enqueue.
		const result = await scheduleBuilds({
			installationId: "9001",
			repo: "hanzoai/zip",
			sha: "a".repeat(40),
			ref: "refs/heads/main",
			branch: "main",
		});
		expect(result).not.toBeNull();
		expect(result?.jobs).toHaveLength(1);
		const job = result?.jobs[0];
		expect(job?.dispatchId).toBe(`native:${job?.buildJobId}`);
		expect(job?.status).toBe("running");

		// 4. Worker receives the job off the real queue.
		const build = await pulled;
		expect(build).not.toBeNull();
		expect(build?.buildJobId).toBe(job?.buildJobId);
		expect(build?.image).toBe(`ghcr.io/hanzoai/zip:${"a".repeat(40)}`);
		expect(build?.dockerfile).toBe("./Dockerfile");
		expect(build?.installationId).toBe("9001");

		// 5. Worker built+pushed the image; report success. This drives the
		//    DeployExecutor, which patches the operator Service CR.
		const completion = await completeBuild({
			buildJobId: build?.buildJobId as string,
			outcome: "success",
			installationId: build?.installationId as string,
			log: "image_digest=sha256:deadbeef",
		});

		expect(completion.status).toBe("succeeded");
		expect(completion.deploy?.rolledOut).toBe(true);
		expect(patchCalls).toHaveLength(1);
		expect(patchCalls[0]?.name).toBe("zip");
		expect(patchCalls[0]?.namespace).toBe("hanzo");
		expect((patchCalls[0]?.body as { spec: { image: { tag: string } } }).spec.image.tag).toBe(
			"a".repeat(40),
		);

		// 6. The buildJob row reached its terminal, deployed state.
		const finished = store.build_job.get(job?.buildJobId as string);
		expect(finished?.status).toBe("succeeded");
		expect(finished?.rolloutStatus).toBe("applied");

		const elapsedMs = Date.now() - t0;
		// Native path is in-process: no GHA queue latency. Bound it generously.
		expect(elapsedMs).toBeLessThan(2_000);
		// Surface timing for the run log.
		// eslint-disable-next-line no-console
		console.log(`[integration] dispatch→deploy completed in ${elapsedMs}ms`);

		ctrl.abort();
	});

	it("falls back to workflow_dispatch when no live runner serves the pool", async () => {
		// No runner registered for any candidate pool ⇒ resolveTarget returns
		// { kind: "workflow_dispatch" }, and the mocked createWorkflowDispatch
		// throws — proving the scheduler took the fallback branch (and did NOT
		// silently native-enqueue).
		await expect(
			scheduleBuilds({
				installationId: "9001",
				repo: "hanzoai/zip",
				sha: "b".repeat(40),
				ref: "refs/heads/main",
				branch: "main",
			}),
		).rejects.toThrow("workflow_dispatch must NOT be called on the native path");
		// Nothing landed on the native queue.
		expect(buildQueue.backlogSize(POOL)).toBe(0);
	});
});
