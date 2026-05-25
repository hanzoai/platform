/**
 * CR builder tests pin the wire shape of the operator-bound CRs.
 * Field changes here are breaking changes to the operator contract.
 */
import { describe, expect, it } from "vitest";

import {
	buildMongoCR,
	buildPostgresCR,
	buildRedisCR,
	KIND_TO_PLURAL,
	OPERATOR_GROUP,
	OPERATOR_VERSION,
} from "@hanzo/platform/services/k8s/operator/cr-builder";

const META = {
	organizationId: "org-acme",
	namespace: "tenant-org-acme",
	resourceId: "pg_abc",
	paasTicket: "pending",
	source: "platform.hanzo.ai" as const,
};

const PG_FIXTURE = {
	postgresId: "pg_abc",
	name: "prod-db",
	appName: "prod-db-abc",
	databaseName: "appdb",
	databaseUser: "appuser",
	databasePassword: "hunter2",
	dockerImage: "postgres:16-alpine",
	replicas: 1,
} as any;

const REDIS_FIXTURE = {
	redisId: "rd_xyz",
	appName: "cache-xyz",
	databasePassword: "swordfish",
	dockerImage: "redis:7-alpine",
} as any;

const MONGO_FIXTURE = {
	mongoId: "mg_qrs",
	appName: "mongo-qrs",
	databaseUser: "root",
	databasePassword: "letmein",
	dockerImage: "mongo:7",
} as any;

describe("buildPostgresCR", () => {
	const cr = buildPostgresCR(PG_FIXTURE, META, {
		storageSize: "10Gi",
		storageClassName: "do-block-storage",
		resources: { requests: { cpu: "250m", memory: "512Mi" } },
	});

	it("sets the operator group/version/kind", () => {
		expect(cr.apiVersion).toBe(`${OPERATOR_GROUP}/${OPERATOR_VERSION}`);
		expect(cr.kind).toBe("SQL");
	});

	it("scopes the resource to the tenant namespace", () => {
		expect(cr.metadata.namespace).toBe("tenant-org-acme");
		expect(cr.metadata.labels["hanzo.ai/tenant"]).toBe("org-acme");
		expect(cr.metadata.annotations["hanzo.ai/tenant"]).toBe("org-acme");
	});

	it("declares datastore type=postgresql", () => {
		expect(cr.spec.type).toBe("postgresql");
	});

	it("wires POSTGRES_PASSWORD to the per-CR credentials secret", () => {
		const pwd = cr.spec.env?.find((e) => e.name === "POSTGRES_PASSWORD");
		expect(pwd?.valueFrom?.secretKeyRef).toEqual({
			name: "prod-db-abc-credentials",
			key: "password",
		});
	});

	it("publishes a 5432 port", () => {
		expect(cr.spec.ports?.[0]?.containerPort).toBe(5432);
	});

	it("includes the storage size and class from options", () => {
		expect(cr.spec.storage.size).toBe("10Gi");
		expect(cr.spec.storage.storageClassName).toBe("do-block-storage");
	});

	it("passes the resource requests through", () => {
		expect(cr.spec.resources?.requests?.cpu).toBe("250m");
	});
});

describe("buildRedisCR", () => {
	const cr = buildRedisCR(REDIS_FIXTURE, META, { storageSize: "2Gi" });

	it("targets KV with type=valkey", () => {
		expect(cr.kind).toBe("KV");
		expect(cr.spec.type).toBe("valkey");
	});

	it("publishes a 6379 port", () => {
		expect(cr.spec.ports?.[0]?.containerPort).toBe(6379);
	});
});

describe("buildMongoCR", () => {
	const cr = buildMongoCR(MONGO_FIXTURE, META, { storageSize: "5Gi" });

	it("targets DocDB with type=docdb", () => {
		expect(cr.kind).toBe("DocDB");
		expect(cr.spec.type).toBe("docdb");
	});

	it("publishes a 27017 port", () => {
		expect(cr.spec.ports?.[0]?.containerPort).toBe(27017);
	});

	it("wires MONGO_INITDB_ROOT_PASSWORD to the credentials secret", () => {
		const pwd = cr.spec.env?.find((e) => e.name === "MONGO_INITDB_ROOT_PASSWORD");
		expect(pwd?.valueFrom?.secretKeyRef?.key).toBe("password");
	});
});

describe("KIND_TO_PLURAL", () => {
	it("maps to the same plurals the operator's CRD declares", () => {
		expect(KIND_TO_PLURAL.SQL).toBe("sqls");
		expect(KIND_TO_PLURAL.KV).toBe("kvs");
		expect(KIND_TO_PLURAL.DocDB).toBe("docdbs");
		expect(KIND_TO_PLURAL.Service).toBe("services");
	});
});
