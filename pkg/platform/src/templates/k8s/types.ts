/**
 * Kubernetes manifest template types for the Hanzo Platform.
 *
 * These types describe the shape of:
 *   - Infrastructure manifests (Deployment, StatefulSet, CronJob, etc.)
 *   - One-click stack templates (MongoDB, PostgreSQL, Redis, etc.)
 *   - The template registry that indexes all available stacks
 */

// ---------------------------------------------------------------------------
// Resource unit helpers
// ---------------------------------------------------------------------------

export type CpuRequestType = "millicores" | "cores";
export type MemoryRequestType = "mebibyte" | "gibibyte";
export type StorageSizeType = "mebibyte" | "gibibyte";

/** Maps human-friendly unit names to Kubernetes suffixes. */
export const UNIT_SUFFIX: Record<string, string> = {
	millicores: "m",
	cores: "",
	mebibyte: "Mi",
	gibibyte: "Gi",
};

// ---------------------------------------------------------------------------
// Pod / container resource configuration
// ---------------------------------------------------------------------------

export interface PodConfig {
	restartPolicy?: string;
	cpuRequest: number;
	cpuRequestType: CpuRequestType;
	cpuLimit: number;
	cpuLimitType: CpuRequestType;
	memoryRequest: number;
	memoryRequestType: MemoryRequestType;
	memoryLimit: number;
	memoryLimitType: MemoryRequestType;
}

export interface StorageConfig {
	enabled: boolean;
	mountPath?: string;
	size: number;
	sizeType: StorageSizeType;
	accessModes?: string[];
}

export interface StatefulSetConfig {
	strategy?: string;
	desiredReplicas?: number;
	revisionHistoryLimit?: number;
	podManagementPolicy?: string;
	rollingUpdate?: {
		maxUnavailable: number | string;
		partition: number;
	};
	persistentVolumeClaimRetentionPolicy?: {
		whenDeleted: string;
		whenScaled: string;
	};
}

export interface DeploymentConfig {
	desiredReplicas?: number;
	cpuMetric?: { enabled: boolean };
	memoryMetric?: { enabled: boolean };
}

export interface NetworkingConfig {
	containerPort: number;
	tcpProxy?: { enabled: boolean };
}

export interface RegistryConfig {
	registryId?: string;
	imageUrl?: string;
}

// ---------------------------------------------------------------------------
// Template variable expression helpers
// ---------------------------------------------------------------------------

/**
 * Secret expressions use the format `{{random:N}}` to generate a random
 * string of length N, or a literal string value.
 */
export interface TemplateSecrets {
	[key: string]: string;
}

/**
 * Variable expressions can reference secrets via `{{secret:keyName}}`.
 */
export interface TemplateVariables {
	[key: string]: string;
}

// ---------------------------------------------------------------------------
// One-click stack template definition
// ---------------------------------------------------------------------------

export interface StackTemplateConfig {
	visibleSections: string[];
	visibleFields: string[];
	disabledFields: string[];
	defaultValues: Record<string, unknown>;
	secrets: TemplateSecrets;
	variables: TemplateVariables;
}

export type StackType = "deployment" | "statefulset" | "cronjob";

export interface StackTemplate {
	name: string;
	description: string;
	manifest: string;
	version: string;
	isLatest: boolean;
	type: StackType;
	config: StackTemplateConfig;
}

export interface StackCategory {
	category: string;
	templates: StackTemplate[];
}

// ---------------------------------------------------------------------------
// Infrastructure manifest names
// ---------------------------------------------------------------------------

export type InfraManifest =
	| "deployment"
	| "statefulset"
	| "cronjob"
	| "service"
	| "namespace"
	| "pvc"
	| "hpa"
	| "github-pipeline"
	| "gitlab-pipeline"
	| "bitbucket-pipeline";

// ---------------------------------------------------------------------------
// Substitution context passed to template rendering
// ---------------------------------------------------------------------------

export interface SubstitutionContext {
	/** Instance ID -- replaces `{{iid}}` */
	iid: string;
	/** Kubernetes namespace -- replaces `{{namespace}}` */
	namespace: string;
	/** Resolved secrets (after random generation) */
	secrets: Record<string, string>;
	/** Registry configuration */
	registry: RegistryConfig;
	/** Pod resource config */
	podConfig: PodConfig;
	/** Storage config */
	storageConfig: StorageConfig;
	/** StatefulSet-specific config (optional) */
	statefulSetConfig?: StatefulSetConfig;
	/** Deployment-specific config (optional) */
	deploymentConfig?: DeploymentConfig;
	/** Networking config (optional) */
	networking?: NetworkingConfig;
	/** Arbitrary extra variables for indexed access, e.g. `variables.0.name` */
	variables?: Array<{ name: string; value: string }>;
}
