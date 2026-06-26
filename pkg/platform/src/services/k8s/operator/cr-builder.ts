/**
 * Operator CR builder.
 *
 * Translates platform's internal DB/app config into operator-managed
 * Custom Resources targeting the hanzoai/operator CRD contract.
 *
 * Operator CRD reference: ~/work/hanzo/operator/src/crd.rs
 *   - apiVersion: hanzo.ai/v1
 *   - Kinds: SQL, KV, DocDB, Service, Datastore (full DatastoreSpec/ServiceSpec)
 *
 * Mapping (platform → operator):
 *   Postgres → SQL    (inner DatastoreSpec type=postgresql)
 *   Redis    → KV     (inner DatastoreSpec type=valkey)
 *   Mongo    → DocDB  (inner DatastoreSpec type=docdb)
 *   App      → Service (full ServiceSpec)
 *
 * MariaDB/MySQL have no direct mapping (no operator CRD). Caller MUST
 * either skip those or surface a clear UX-side error before reaching
 * this layer.
 */
import type { Postgres } from "../../postgres";
import type { Redis } from "../../redis";
import type { Mongo } from "../../mongo";
// Canonical image-ref parser lives in the CI module — one implementation only.
import { parseImageRef } from "../../ci/image-ref";

// ---------------------------------------------------------------------------
// Wire-shape types (mirror operator/src/crd.rs DatastoreSpec/ServiceSpec)
// ---------------------------------------------------------------------------

export const OPERATOR_GROUP = "hanzo.ai";
export const OPERATOR_VERSION = "v1";

/** CRD kinds we materialize from the platform UI. */
export type OperatorKind = "SQL" | "KV" | "DocDB" | "Service";

export interface ImageSpec {
	repository: string;
	tag?: string;
	pullPolicy?: "Always" | "IfNotPresent" | "Never";
}

export interface StorageSpec {
	storageClassName?: string;
	/** K8s quantity string e.g. "10Gi" */
	size: string;
	retentionPolicy?: "Retain" | "Delete";
}

export interface ResourceRequirements {
	requests?: Record<string, string>;
	limits?: Record<string, string>;
}

export interface EnvVar {
	name: string;
	value?: string;
	valueFrom?: {
		secretKeyRef?: { name: string; key: string };
		configMapKeyRef?: { name: string; key: string };
	};
}

export interface ServicePort {
	name: string;
	containerPort: number;
	servicePort?: number;
	protocol?: "TCP" | "UDP";
}

/** Operator DatastoreSpec — wire-identical with rust crd.rs. */
export interface DatastoreSpec {
	type: "postgresql" | "valkey" | "docdb" | "minio" | string;
	image?: ImageSpec;
	replicas?: number;
	storage: StorageSpec;
	resources?: ResourceRequirements;
	env?: EnvVar[];
	credentialsSecret?: string;
	serviceAliases?: string[];
	ports?: ServicePort[];
	partOf?: string;
}

/**
 * Operator ServiceSpec (kind=Service) — minimal subset used by platform
 * "deploy app" flow. Named `OperatorServiceSpec` to disambiguate from
 * `k8s-service.ts:ServiceSpec` (the K8s native Service primitive helper).
 */
export interface OperatorServiceSpec {
	image: ImageSpec;
	replicas?: number;
	ports?: ServicePort[];
	env?: EnvVar[];
	resources?: ResourceRequirements;
	ingress?: {
		enabled: boolean;
		hosts?: string[];
		ingressClassName?: string;
		tls?: boolean;
		clusterIssuer?: string;
	};
	autoscaling?: { enabled: boolean; minReplicas?: number; maxReplicas?: number; targetCpuUtilization?: number };
	partOf?: string;
	component?: string;
}

/** Operator-managed CR envelope. */
export interface CustomResource<Spec> {
	apiVersion: string;
	kind: OperatorKind;
	metadata: {
		name: string;
		namespace: string;
		labels: Record<string, string>;
		annotations: Record<string, string>;
	};
	spec: Spec;
}

// ---------------------------------------------------------------------------
// Common metadata
// ---------------------------------------------------------------------------

export const ANNOTATION_TENANT = "hanzo.ai/tenant";
export const ANNOTATION_PAAS_TICKET = "hanzo.ai/paas-ticket";
export const ANNOTATION_PAAS_SOURCE = "hanzo.ai/paas-source";

export interface CRMetadataInput {
	organizationId: string;
	namespace: string;
	resourceId: string;
	/**
	 * Signed PaaS admission ticket. Required for tenant-namespace datastore CRs
	 * (the operator's tenant-mode webhook validates it). Omitted for first-party
	 * deploy-target Service CRs, which live outside tenant mode — there is no
	 * ticket to stamp, so the annotation is simply not set.
	 */
	paasTicket?: string;
	source: "platform.hanzo.ai";
}

function buildMetadata(name: string, kind: OperatorKind, input: CRMetadataInput) {
	const annotations: Record<string, string> = {
		[ANNOTATION_TENANT]: input.organizationId,
		[ANNOTATION_PAAS_SOURCE]: input.source,
	};
	if (input.paasTicket) {
		annotations[ANNOTATION_PAAS_TICKET] = input.paasTicket;
	}
	return {
		name,
		namespace: input.namespace,
		labels: {
			"app.kubernetes.io/managed-by": "hanzo-platform",
			"app.kubernetes.io/instance": name,
			"hanzo.ai/tenant": input.organizationId,
			"hanzo.ai/kind": kind,
			"hanzo.ai/resource-id": input.resourceId,
		},
		annotations,
	};
}

// ---------------------------------------------------------------------------
// Postgres → SQL CR
// ---------------------------------------------------------------------------

export interface PostgresCROptions {
	/** Storage size as K8s quantity string. Caller chooses based on plan tier. */
	storageSize: string;
	/** Resource requests/limits. Caller chooses based on plan tier. */
	resources?: ResourceRequirements;
	/** Storage class. Cluster-dependent (e.g. "do-block-storage"). */
	storageClassName?: string;
}

export function buildPostgresCR(
	pg: Postgres,
	meta: CRMetadataInput,
	opts: PostgresCROptions,
): CustomResource<DatastoreSpec> {
	const credentialsSecret = `${pg.appName}-credentials`;

	// Parse `postgres:16-alpine` style. Fall back to the whole string as repo.
	const [repo, tag] = parseImageRef(pg.dockerImage);

	return {
		apiVersion: `${OPERATOR_GROUP}/${OPERATOR_VERSION}`,
		kind: "SQL",
		metadata: buildMetadata(pg.appName, "SQL", meta),
		spec: {
			type: "postgresql",
			image: { repository: repo, tag, pullPolicy: "IfNotPresent" },
			replicas: pg.replicas ?? 1,
			storage: {
				storageClassName: opts.storageClassName,
				size: opts.storageSize,
				retentionPolicy: "Retain",
			},
			resources: opts.resources,
			env: [
				{ name: "POSTGRES_USER", value: pg.databaseUser },
				{ name: "POSTGRES_DB", value: pg.databaseName },
				{
					name: "POSTGRES_PASSWORD",
					valueFrom: { secretKeyRef: { name: credentialsSecret, key: "password" } },
				},
				{ name: "PGDATA", value: "/var/lib/postgresql/data/pgdata" },
			],
			credentialsSecret,
			serviceAliases: [pg.appName, `${pg.appName}-postgres`],
			ports: [{ name: "postgres", containerPort: 5432, protocol: "TCP" }],
			partOf: `tenant-${meta.organizationId}`,
		},
	};
}

// ---------------------------------------------------------------------------
// Redis → KV CR
// ---------------------------------------------------------------------------

export interface RedisCROptions {
	storageSize: string;
	resources?: ResourceRequirements;
	storageClassName?: string;
}

export function buildRedisCR(
	r: Redis,
	meta: CRMetadataInput,
	opts: RedisCROptions,
): CustomResource<DatastoreSpec> {
	const credentialsSecret = `${r.appName}-credentials`;
	const [repo, tag] = parseImageRef(r.dockerImage);

	return {
		apiVersion: `${OPERATOR_GROUP}/${OPERATOR_VERSION}`,
		kind: "KV",
		metadata: buildMetadata(r.appName, "KV", meta),
		spec: {
			type: "valkey",
			image: { repository: repo, tag, pullPolicy: "IfNotPresent" },
			replicas: 1,
			storage: {
				storageClassName: opts.storageClassName,
				size: opts.storageSize,
				retentionPolicy: "Retain",
			},
			resources: opts.resources,
			env: [
				{
					name: "REDIS_PASSWORD",
					valueFrom: { secretKeyRef: { name: credentialsSecret, key: "password" } },
				},
			],
			credentialsSecret,
			serviceAliases: [r.appName, `${r.appName}-redis`],
			ports: [{ name: "redis", containerPort: 6379, protocol: "TCP" }],
			partOf: `tenant-${meta.organizationId}`,
		},
	};
}

// ---------------------------------------------------------------------------
// Mongo → DocDB CR (FerretDB / Mongo wire protocol)
// ---------------------------------------------------------------------------

export interface MongoCROptions {
	storageSize: string;
	resources?: ResourceRequirements;
	storageClassName?: string;
}

export function buildMongoCR(
	m: Mongo,
	meta: CRMetadataInput,
	opts: MongoCROptions,
): CustomResource<DatastoreSpec> {
	const credentialsSecret = `${m.appName}-credentials`;
	const [repo, tag] = parseImageRef(m.dockerImage);

	return {
		apiVersion: `${OPERATOR_GROUP}/${OPERATOR_VERSION}`,
		kind: "DocDB",
		metadata: buildMetadata(m.appName, "DocDB", meta),
		spec: {
			type: "docdb",
			image: { repository: repo, tag, pullPolicy: "IfNotPresent" },
			replicas: 1,
			storage: {
				storageClassName: opts.storageClassName,
				size: opts.storageSize,
				retentionPolicy: "Retain",
			},
			resources: opts.resources,
			env: [
				{ name: "MONGO_INITDB_ROOT_USERNAME", value: m.databaseUser },
				{
					name: "MONGO_INITDB_ROOT_PASSWORD",
					valueFrom: { secretKeyRef: { name: credentialsSecret, key: "password" } },
				},
			],
			credentialsSecret,
			serviceAliases: [m.appName, `${m.appName}-mongo`],
			ports: [{ name: "mongo", containerPort: 27017, protocol: "TCP" }],
			partOf: `tenant-${meta.organizationId}`,
		},
	};
}

// ---------------------------------------------------------------------------
// App → Service CR
// ---------------------------------------------------------------------------

export interface ServiceCROptions {
	/** Container image to run. */
	image: ImageSpec;
	replicas?: number;
	ports?: ServicePort[];
	env?: EnvVar[];
	resources?: ResourceRequirements;
	ingress?: OperatorServiceSpec["ingress"];
	autoscaling?: OperatorServiceSpec["autoscaling"];
}

/**
 * Build a minimal operator `Service` CR for the CI/CD deploy path.
 *
 * Used when a deploy targets a Service CR that does not yet exist: rather than
 * erroring, the DeployExecutor creates it from the freshly-built image so a
 * newly-connected repo deploys with zero manual CR. Only `image` is required;
 * the operator fills in defaults for everything else and reconciles the
 * Deployment/Service/Ingress.
 */
export function buildServiceCR(
	name: string,
	meta: CRMetadataInput,
	opts: ServiceCROptions,
): CustomResource<OperatorServiceSpec> {
	return {
		apiVersion: `${OPERATOR_GROUP}/${OPERATOR_VERSION}`,
		kind: "Service",
		metadata: buildMetadata(name, "Service", meta),
		spec: {
			image: opts.image,
			replicas: opts.replicas ?? 1,
			...(opts.ports ? { ports: opts.ports } : {}),
			...(opts.env ? { env: opts.env } : {}),
			...(opts.resources ? { resources: opts.resources } : {}),
			...(opts.ingress ? { ingress: opts.ingress } : {}),
			...(opts.autoscaling ? { autoscaling: opts.autoscaling } : {}),
			partOf: `tenant-${meta.organizationId}`,
		},
	};
}

// ---------------------------------------------------------------------------
// Kind → plural mapping (CustomObjectsApi needs the plural)
// ---------------------------------------------------------------------------

export const KIND_TO_PLURAL: Record<OperatorKind, string> = {
	SQL: "sqls",
	KV: "kvs",
	DocDB: "docdbs",
	Service: "services",
};
