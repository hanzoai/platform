/**
 * DigitalOcean Service
 *
 * Handles all interactions with the DigitalOcean API for provisioning
 * and managing compute resources. Implements the cloud provider abstraction
 * for Platform's multi-cloud architecture.
 *
 * Features:
 * - Instance lifecycle management (create, delete, resize)
 * - Firewall management
 * - Load balancer integration
 * - VPC/private networking
 * - SSH key management
 */

import { db } from "@hanzo/platform/db";
import {
	cloudProvider,
	provisionedInstance,
	scalingJob,
	type CloudProvider,
	type ProvisionedInstance,
} from "@hanzo/platform/db/schema/cloud-provider";
import {
	computeNode,
	computePool,
} from "@hanzo/platform/db/schema/compute-pool";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

// ============================================================================
// Types
// ============================================================================

interface DOConfig {
	apiToken: string;
	baseUrl?: string;
}

interface DropletCreateRequest {
	name: string;
	region: string;
	size: string;
	image: string;
	ssh_keys?: (string | number)[];
	backups?: boolean;
	ipv6?: boolean;
	user_data?: string;
	private_networking?: boolean;
	volumes?: string[];
	tags?: string[];
	vpc_uuid?: string;
	with_droplet_agent?: boolean;
}

interface DropletResponse {
	id: number;
	name: string;
	status: string;
	created_at: string;
	region: {
		slug: string;
		name: string;
	};
	size: {
		slug: string;
		vcpus: number;
		memory: number;
		disk: number;
		price_monthly: number;
		price_hourly: number;
	};
	networks: {
		v4: Array<{
			ip_address: string;
			netmask: string;
			gateway: string;
			type: "public" | "private";
		}>;
		v6: Array<{
			ip_address: string;
			netmask: number;
			gateway: string;
			type: "public" | "private";
		}>;
	};
	tags: string[];
}

interface DOSize {
	slug: string;
	memory: number;
	vcpus: number;
	disk: number;
	transfer: number;
	price_monthly: number;
	price_hourly: number;
	regions: string[];
	available: boolean;
	description: string;
}

interface DORegion {
	slug: string;
	name: string;
	sizes: string[];
	available: boolean;
	features: string[];
}

interface FirewallRule {
	protocol: "tcp" | "udp" | "icmp";
	ports: string;
	sources?: {
		addresses?: string[];
		droplet_ids?: number[];
		tags?: string[];
	};
	destinations?: {
		addresses?: string[];
		droplet_ids?: number[];
		tags?: string[];
	};
}

// ============================================================================
// API Client
// ============================================================================

class DigitalOceanClient {
	private apiToken: string;
	private baseUrl: string;

	constructor(config: DOConfig) {
		this.apiToken = config.apiToken;
		this.baseUrl = config.baseUrl || "https://api.digitalocean.com/v2";
	}

	private async request<T>(
		path: string,
		options: RequestInit = {}
	): Promise<T> {
		const url = `${this.baseUrl}${path}`;
		const response = await fetch(url, {
			...options,
			headers: {
				Authorization: `Bearer ${this.apiToken}`,
				"Content-Type": "application/json",
				...options.headers,
			},
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`DO API Error (${response.status}): ${error}`);
		}

		// Handle 204 No Content
		if (response.status === 204) {
			return {} as T;
		}

		return response.json();
	}

	// Account
	async getAccount() {
		return this.request<{ account: { email: string; status: string } }>("/account");
	}

	// Droplets (DO API uses "droplet" terminology)
	async createDroplet(data: DropletCreateRequest) {
		return this.request<{ droplet: DropletResponse }>("/droplets", {
			method: "POST",
			body: JSON.stringify(data),
		});
	}

	async getDroplet(dropletId: number) {
		return this.request<{ droplet: DropletResponse }>(`/droplets/${dropletId}`);
	}

	async listDroplets(tag?: string) {
		const path = tag ? `/droplets?tag_name=${encodeURIComponent(tag)}` : "/droplets";
		return this.request<{ droplets: DropletResponse[] }>(path);
	}

	async deleteDroplet(dropletId: number) {
		return this.request<void>(`/droplets/${dropletId}`, { method: "DELETE" });
	}

	async dropletAction(dropletId: number, action: { type: string; [key: string]: unknown }) {
		return this.request<{ action: { id: number; status: string } }>(
			`/droplets/${dropletId}/actions`,
			{
				method: "POST",
				body: JSON.stringify(action),
			}
		);
	}

	async getAction(actionId: number) {
		return this.request<{ action: { id: number; status: string; type: string } }>(
			`/actions/${actionId}`
		);
	}

	// Sizes
	async listSizes() {
		return this.request<{ sizes: DOSize[] }>("/sizes");
	}

	// Regions
	async listRegions() {
		return this.request<{ regions: DORegion[] }>("/regions");
	}

	// SSH Keys
	async listSSHKeys() {
		return this.request<{ ssh_keys: Array<{ id: number; name: string; fingerprint: string }> }>(
			"/account/keys"
		);
	}

	async createSSHKey(name: string, publicKey: string) {
		return this.request<{ ssh_key: { id: number; name: string; fingerprint: string } }>(
			"/account/keys",
			{
				method: "POST",
				body: JSON.stringify({ name, public_key: publicKey }),
			}
		);
	}

	// VPCs
	async listVPCs() {
		return this.request<{ vpcs: Array<{ id: string; name: string; region: string }> }>("/vpcs");
	}

	async createVPC(name: string, region: string, ipRange: string = "10.10.10.0/24") {
		return this.request<{ vpc: { id: string; name: string } }>("/vpcs", {
			method: "POST",
			body: JSON.stringify({ name, region, ip_range: ipRange }),
		});
	}

	// Firewalls
	async createFirewall(
		name: string,
		inboundRules: FirewallRule[],
		outboundRules: FirewallRule[],
		tags?: string[]
	) {
		return this.request<{ firewall: { id: string; name: string } }>("/firewalls", {
			method: "POST",
			body: JSON.stringify({
				name,
				inbound_rules: inboundRules,
				outbound_rules: outboundRules,
				tags,
			}),
		});
	}

	async addDropletsToFirewall(firewallId: string, dropletIds: number[]) {
		return this.request<void>(`/firewalls/${firewallId}/droplets`, {
			method: "POST",
			body: JSON.stringify({ droplet_ids: dropletIds }),
		});
	}

	// Load Balancers
	async createLoadBalancer(config: {
		name: string;
		region: string;
		algorithm?: string;
		forwarding_rules: Array<{
			entry_protocol: string;
			entry_port: number;
			target_protocol: string;
			target_port: number;
			tls_passthrough?: boolean;
		}>;
		health_check?: {
			protocol: string;
			port: number;
			path?: string;
			check_interval_seconds?: number;
			response_timeout_seconds?: number;
			unhealthy_threshold?: number;
			healthy_threshold?: number;
		};
		droplet_ids?: number[];
		tag?: string;
	}) {
		return this.request<{ load_balancer: { id: string; ip: string; status: string } }>(
			"/load_balancers",
			{
				method: "POST",
				body: JSON.stringify(config),
			}
		);
	}

	async addDropletsToLoadBalancer(lbId: string, dropletIds: number[]) {
		return this.request<void>(`/load_balancers/${lbId}/droplets`, {
			method: "POST",
			body: JSON.stringify({ droplet_ids: dropletIds }),
		});
	}

	async removeDropletsFromLoadBalancer(lbId: string, dropletIds: number[]) {
		return this.request<void>(`/load_balancers/${lbId}/droplets`, {
			method: "DELETE",
			body: JSON.stringify({ droplet_ids: dropletIds }),
		});
	}
}

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Get a DO client instance for a provider
 */
async function getClient(providerId: string): Promise<DigitalOceanClient> {
	const provider = await db.query.cloudProvider.findFirst({
		where: eq(cloudProvider.providerId, providerId),
	});

	if (!provider) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Cloud provider not found",
		});
	}

	if (provider.providerType !== "digitalocean") {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Provider is not DigitalOcean",
		});
	}

	const apiToken = provider.credentials?.apiToken;
	if (!apiToken) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Provider has no API token configured",
		});
	}

	// In production, decrypt the token here
	// const decryptedToken = await decrypt(apiToken);

	return new DigitalOceanClient({ apiToken });
}

/**
 * Configure a new DigitalOcean provider
 */
export async function configureDigitalOceanProvider(
	organizationId: string,
	config: {
		name: string;
		slug: string;
		apiToken: string;
		region?: string;
		projectId?: string;
	}
): Promise<CloudProvider> {
	// Validate token by making test API call
	const client = new DigitalOceanClient({ apiToken: config.apiToken });

	try {
		await client.getAccount();
	} catch (error) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Invalid DigitalOcean API token",
		});
	}

	// In production, encrypt the token here
	// const encryptedToken = await encrypt(config.apiToken);

	const [provider] = await db
		.insert(cloudProvider)
		.values({
			organizationId,
			providerType: "digitalocean",
			name: config.name,
			slug: config.slug,
			credentials: {
				apiToken: config.apiToken, // Should be encrypted
				region: config.region,
				projectId: config.projectId,
			},
			defaultRegion: config.region || "nyc1",
			lastValidated: new Date(),
		} as any)
		.returning();

	if (!provider) {
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: "Failed to create cloud provider record",
		});
	}

	return provider;
}

/**
 * List available instance sizes
 */
export async function listInstanceSizes(
	providerId: string,
	region?: string
): Promise<DOSize[]> {
	const client = await getClient(providerId);
	const { sizes } = await client.listSizes();

	if (region) {
		return sizes.filter((s) => s.regions.includes(region) && s.available);
	}

	return sizes.filter((s) => s.available);
}

/**
 * List available regions
 */
export async function listRegions(providerId: string): Promise<DORegion[]> {
	const client = await getClient(providerId);
	const { regions } = await client.listRegions();
	return regions.filter((r) => r.available);
}

/**
 * Create a new instance
 */
export async function createInstance(
	providerId: string,
	config: {
		poolId: string;
		name: string;
		size: string;
		region: string;
		nodeType: string;
		labels?: Record<string, string>;
	}
): Promise<string> {
	const client = await getClient(providerId);
	const provider = await db.query.cloudProvider.findFirst({
		where: eq(cloudProvider.providerId, providerId),
	});

	if (!provider) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Provider not found" });
	}

	// Get pool for swarm join info
	const pool = await db.query.computePool.findFirst({
		where: eq(computePool.poolId, config.poolId),
	});

	// Generate tokens
	const registrationToken = nanoid(32);
	const registrationExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

	// Get instance specs for database record
	const specs = getInstanceSpecs(config.size);

	// Build tags (nodeId added after insert)
	const baseTags = [
		`pool:${config.poolId}`,
		`type:${config.nodeType}`,
		...Object.entries(config.labels || {}).map(([k, v]) => `${k}:${v}`),
	];

	// Create database records in transaction first to get IDs
	const result = await db.transaction(async (tx) => {
		// Create compute node record (pending) - let Drizzle generate nodeId
		const [node] = await tx.insert(computeNode).values({
			poolId: config.poolId,
			name: config.name,
			region: config.region,
			nodeType: config.nodeType,
			status: "offline",
			cpuCores: specs.cpuCores,
			memoryMb: specs.memoryMb,
			storageGb: specs.storageGb,
		} as any).returning();

		if (!node) {
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: "Failed to create compute node record",
			});
		}

		return { nodeId: node.nodeId };
	});

	const { nodeId } = result;

	// Build tags with nodeId
	const tags = [
		...baseTags,
		`node:${nodeId}`,
	];

	// Build cloud-init script
	const cloudInit = buildCloudInitScript({
		nodeId,
		poolId: config.poolId,
		registrationToken,
		swarmManagerIp: pool?.networkAddress || "",
		platformApiUrl: process.env.PLATFORM_API_URL || "https://platform.hanzo.ai",
	});

	// Create instance via DO API
	const { droplet } = await client.createDroplet({
		name: config.name,
		region: config.region,
		size: config.size,
		image: provider.defaultImage || "ubuntu-22-04-x64",
		ssh_keys: provider.sshKeyIds?.map((id) => parseInt(id)) || [],
		user_data: cloudInit,
		tags,
		vpc_uuid: provider.vpcConfig?.vpcId,
		with_droplet_agent: true,
		ipv6: true,
	});

	// Extract IPs
	const publicIp = droplet.networks.v4.find((n) => n.type === "public")?.ip_address;
	const privateIp = droplet.networks.v4.find((n) => n.type === "private")?.ip_address;

	// Update compute node with IP and create provisioned instance record
	await db.transaction(async (tx) => {
		// Update compute node with IP
		await tx
			.update(computeNode)
			.set({
				ipAddress: publicIp,
				updatedAt: new Date(),
			} as any)
			.where(eq(computeNode.nodeId, nodeId));

		// Create provisioned instance record - let Drizzle generate instanceId
		await tx.insert(provisionedInstance).values({
			cloudProviderId: providerId,
			poolId: config.poolId,
			computeNodeId: nodeId,
			externalId: String(droplet.id),
			externalName: config.name,
			region: config.region,
			size: config.size,
			image: provider.defaultImage || "ubuntu-22-04-x64",
			status: "provisioning",
			publicIp,
			privateIp,
			registrationToken,
			registrationExpiry,
			cpuCores: specs.cpuCores,
			memoryMb: specs.memoryMb,
			storageGb: specs.storageGb,
			hourlyPrice: String(droplet.size.price_hourly),
			monthlyPrice: String(droplet.size.price_monthly),
			tags,
			provisionedAt: new Date(),
		} as any);
	});

	// Add to firewall if configured
	if (provider.firewallId) {
		try {
			await client.addDropletsToFirewall(provider.firewallId, [droplet.id]);
		} catch (error) {
			console.error("Failed to add instance to firewall:", error);
		}
	}

	return nodeId;
}

/**
 * Delete an instance
 */
export async function deleteInstance(
	instanceId: string,
	force: boolean = false
): Promise<void> {
	const instance = await db.query.provisionedInstance.findFirst({
		where: eq(provisionedInstance.instanceId, instanceId),
		with: { cloudProvider: true },
	});

	if (!instance) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Instance not found" });
	}

	// Drain node first unless force=true
	if (!force && instance.computeNodeId && instance.status === "running") {
		await drainNode(instance.computeNodeId, false);
	}

	// Delete from DO
	if (instance.externalId) {
		const client = await getClient(instance.cloudProviderId);
		try {
			await client.deleteDroplet(parseInt(instance.externalId));
		} catch (error) {
			console.error("Failed to delete instance from provider:", error);
			if (!force) throw error;
		}
	}

	// Update database
	await db.transaction(async (tx) => {
		// Update instance record
		await tx
			.update(provisionedInstance)
			.set({
				status: "terminated",
				terminatedAt: new Date(),
				updatedAt: new Date(),
			} as any)
			.where(eq(provisionedInstance.instanceId, instanceId));

		// Delete compute node record if exists
		if (instance.computeNodeId) {
			await tx
				.delete(computeNode)
				.where(eq(computeNode.nodeId, instance.computeNodeId));
		}
	});

	// Recalculate pool capacity
	if (instance.poolId) {
		await recalculatePoolCapacity(instance.poolId);
	}
}

/**
 * Resize an instance
 */
export async function resizeInstance(config: {
	instanceId: string;
	newSize: string;
	resizeDisk: boolean;
}): Promise<void> {
	const instance = await db.query.provisionedInstance.findFirst({
		where: eq(provisionedInstance.instanceId, config.instanceId),
	});

	if (!instance || !instance.externalId) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Instance not found" });
	}

	const client = await getClient(instance.cloudProviderId);
	const doDropletId = parseInt(instance.externalId);

	// Power off first (required for resize)
	await client.dropletAction(doDropletId, { type: "power_off" });
	await waitForDropletStatus(client, doDropletId, "off", 120);

	// Resize
	await client.dropletAction(doDropletId, {
		type: "resize",
		size: config.newSize,
		disk: config.resizeDisk,
	});
	await waitForDropletStatus(client, doDropletId, "off", 300); // Resize can take a while

	// Power back on
	await client.dropletAction(doDropletId, { type: "power_on" });
	await waitForDropletStatus(client, doDropletId, "active", 120);

	// Update database
	const specs = getInstanceSpecs(config.newSize);

	await db.transaction(async (tx) => {
		await tx
			.update(provisionedInstance)
			.set({
				size: config.newSize,
				cpuCores: specs.cpuCores,
				memoryMb: specs.memoryMb,
				storageGb: config.resizeDisk ? specs.storageGb : instance.storageGb,
				updatedAt: new Date(),
			} as any)
			.where(eq(provisionedInstance.instanceId, config.instanceId));

		if (instance.computeNodeId) {
			await tx
				.update(computeNode)
				.set({
					cpuCores: specs.cpuCores,
					memoryMb: specs.memoryMb,
					storageGb: config.resizeDisk ? specs.storageGb : instance.storageGb,
					updatedAt: new Date(),
				} as any)
				.where(eq(computeNode.nodeId, instance.computeNodeId));
		}
	});

	// Recalculate pool capacity
	if (instance.poolId) {
		await recalculatePoolCapacity(instance.poolId);
	}
}

/**
 * Scale up a pool by adding nodes
 */
export async function scaleUpPool(
	organizationId: string,
	config: {
		poolId: string;
		providerId: string;
		count: number;
		size: string;
		region: string;
		nodeType: string;
		labels?: Record<string, string>;
	}
): Promise<{ jobId: string; nodeIds: string[] }> {
	// Create scaling job record - let Drizzle generate jobId
	const nodeIds: string[] = [];

	const [job] = await db.insert(scalingJob).values({
		poolId: config.poolId,
		cloudProviderId: config.providerId,
		jobType: "scale_up",
		config: {
			count: config.count,
			size: config.size,
			region: config.region,
			nodeType: config.nodeType,
		},
		status: "running",
		startedAt: new Date(),
	} as any).returning();

	if (!job) {
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: "Failed to create scaling job record",
		});
	}

	const jobId = job.jobId;

	// Create instances (batch to avoid rate limits)
	const batchSize = 5;
	for (let i = 0; i < config.count; i += batchSize) {
		const batchPromises = [];
		const batchEnd = Math.min(i + batchSize, config.count);

		for (let j = i; j < batchEnd; j++) {
			const name = `platform-${config.poolId.slice(0, 8)}-${nanoid(6)}`;
			batchPromises.push(
				createInstance(config.providerId, {
					poolId: config.poolId,
					name,
					size: config.size,
					region: config.region,
					nodeType: config.nodeType,
					labels: config.labels,
				})
			);
		}

		const batchResults = await Promise.allSettled(batchPromises);
		for (const result of batchResults) {
			if (result.status === "fulfilled") {
				nodeIds.push(result.value);
			}
		}

		// Update progress
		const progress = Math.round((nodeIds.length / config.count) * 100);
		await db
			.update(scalingJob)
			.set({ progress, createdNodeIds: nodeIds } as any)
			.where(eq(scalingJob.jobId, jobId));
	}

	// Mark job complete
	await db
		.update(scalingJob)
		.set({
			status: nodeIds.length === config.count ? "completed" : "failed",
			progress: 100,
			completedAt: new Date(),
			createdNodeIds: nodeIds,
		} as any)
		.where(eq(scalingJob.jobId, jobId));

	return { jobId, nodeIds };
}

/**
 * Scale down a pool by removing nodes
 */
export async function scaleDownPool(
	organizationId: string,
	config: {
		poolId: string;
		count: number;
		strategy: "oldest" | "newest" | "least-utilized";
		nodeIds?: string[];
	}
): Promise<{ jobId: string; nodeIds: string[] }> {
	const removedNodeIds: string[] = [];

	// Get nodes to remove
	let nodesToRemove: ProvisionedInstance[];

	if (config.nodeIds && config.nodeIds.length > 0) {
		// Specific nodes requested
		nodesToRemove = await db.query.provisionedInstance.findMany({
			where: and(
				eq(provisionedInstance.poolId, config.poolId),
				inArray(provisionedInstance.computeNodeId, config.nodeIds)
			),
		});
	} else {
		// Select based on strategy
		let orderBy;
		switch (config.strategy) {
			case "newest":
				orderBy = desc(provisionedInstance.createdAt);
				break;
			case "least-utilized":
				// Would need to join with compute_node and sort by utilization
				orderBy = provisionedInstance.createdAt;
				break;
			default: // oldest
				orderBy = provisionedInstance.createdAt;
		}

		nodesToRemove = await db.query.provisionedInstance.findMany({
			where: and(
				eq(provisionedInstance.poolId, config.poolId),
				eq(provisionedInstance.status, "running")
			),
			orderBy,
			limit: config.count,
		});
	}

	// Create scaling job - let Drizzle generate jobId
	const [scaleDownJob] = await db.insert(scalingJob).values({
		poolId: config.poolId,
		cloudProviderId: nodesToRemove[0]?.cloudProviderId || "",
		jobType: "scale_down",
		config: {
			count: config.count,
			strategy: config.strategy,
			targetNodeIds: nodesToRemove.map((n) => n.computeNodeId).filter(Boolean) as string[],
		},
		status: "running",
		startedAt: new Date(),
	} as any).returning();

	if (!scaleDownJob) {
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: "Failed to create scale-down job record",
		});
	}

	const jobId = scaleDownJob.jobId;

	// Remove nodes
	for (const instance of nodesToRemove) {
		try {
			await deleteInstance(instance.instanceId, false);
			if (instance.computeNodeId) {
				removedNodeIds.push(instance.computeNodeId);
			}
		} catch (error) {
			console.error(`Failed to remove instance ${instance.instanceId}:`, error);
		}

		// Update progress
		const progress = Math.round((removedNodeIds.length / nodesToRemove.length) * 100);
		await db
			.update(scalingJob)
			.set({ progress, removedNodeIds } as any)
			.where(eq(scalingJob.jobId, jobId));
	}

	// Mark job complete
	await db
		.update(scalingJob)
		.set({
			status: "completed",
			progress: 100,
			completedAt: new Date(),
			removedNodeIds,
		} as any)
		.where(eq(scalingJob.jobId, jobId));

	return { jobId, nodeIds: removedNodeIds };
}

/**
 * Drain a node before removal
 */
export async function drainNode(
	nodeId: string,
	force: boolean = false
): Promise<void> {
	const node = await db.query.computeNode.findFirst({
		where: eq(computeNode.nodeId, nodeId),
		with: { pool: true },
	});

	if (!node) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Node not found" });
	}

	// Update status
	await db
		.update(computeNode)
		.set({ status: "draining", updatedAt: new Date() } as any)
		.where(eq(computeNode.nodeId, nodeId));

	// Get swarm manager to execute drain command
	// In production, this would use the pool's manager server
	// For now, we assume local swarm management
	// const dockerNodeId = await getDockerNodeId(nodeId);
	// if (dockerNodeId) {
	//   await execAsync(`docker node update --availability drain ${dockerNodeId}`);
	//   if (!force) {
	//     await waitForNodeDrain(dockerNodeId, 300);
	//   }
	// }
}

/**
 * Register a node after bootstrap
 */
export async function registerNode(
	nodeId: string,
	registrationToken: string,
	data: {
		publicIp: string;
		privateIp?: string;
		hostname?: string;
		dockerNodeId?: string;
	}
): Promise<void> {
	// Find the instance record
	const instance = await db.query.provisionedInstance.findFirst({
		where: and(
			eq(provisionedInstance.computeNodeId, nodeId),
			eq(provisionedInstance.registrationToken, registrationToken)
		),
	});

	if (!instance) {
		throw new TRPCError({
			code: "UNAUTHORIZED",
			message: "Invalid registration token or node ID",
		});
	}

	// Check token expiry
	if (instance.registrationExpiry && new Date() > instance.registrationExpiry) {
		throw new TRPCError({
			code: "UNAUTHORIZED",
			message: "Registration token expired",
		});
	}

	// Update records
	await db.transaction(async (tx) => {
		await tx
			.update(provisionedInstance)
			.set({
				status: "running",
				publicIp: data.publicIp,
				privateIp: data.privateIp,
				registrationToken: null, // Clear token after use
				registeredAt: new Date(),
				updatedAt: new Date(),
			} as any)
			.where(eq(provisionedInstance.instanceId, instance.instanceId));

		await tx
			.update(computeNode)
			.set({
				status: "online",
				ipAddress: data.publicIp,
				hostname: data.hostname,
				registeredAt: new Date(),
				lastHeartbeat: new Date(),
				updatedAt: new Date(),
			} as any)
			.where(eq(computeNode.nodeId, nodeId));
	});

	// Recalculate pool capacity
	if (instance.poolId) {
		await recalculatePoolCapacity(instance.poolId);
	}
}

/**
 * Create firewall for a pool
 */
export async function createPoolFirewall(
	providerId: string,
	poolId: string
): Promise<string> {
	const client = await getClient(providerId);

	const { firewall } = await client.createFirewall(
		`platform-${poolId.slice(0, 8)}`,
		[
			// SSH
			{ protocol: "tcp", ports: "22", sources: { addresses: ["0.0.0.0/0", "::/0"] } },
			// Docker Swarm ports (internal only)
			{ protocol: "tcp", ports: "2377", sources: { tags: [`pool:${poolId}`] } },
			{ protocol: "tcp", ports: "7946", sources: { tags: [`pool:${poolId}`] } },
			{ protocol: "udp", ports: "7946", sources: { tags: [`pool:${poolId}`] } },
			{ protocol: "udp", ports: "4789", sources: { tags: [`pool:${poolId}`] } },
			// HTTP/HTTPS
			{ protocol: "tcp", ports: "80", sources: { addresses: ["0.0.0.0/0", "::/0"] } },
			{ protocol: "tcp", ports: "443", sources: { addresses: ["0.0.0.0/0", "::/0"] } },
			// Platform monitoring
			{ protocol: "tcp", ports: "4500", sources: { tags: [`pool:${poolId}`] } },
		],
		[
			{ protocol: "tcp", ports: "all", destinations: { addresses: ["0.0.0.0/0", "::/0"] } },
			{ protocol: "udp", ports: "all", destinations: { addresses: ["0.0.0.0/0", "::/0"] } },
			{ protocol: "icmp", ports: "0", destinations: { addresses: ["0.0.0.0/0", "::/0"] } },
		],
		[`pool:${poolId}`]
	);

	// Update provider with firewall ID
	await db
		.update(cloudProvider)
		.set({ firewallId: firewall.id, updatedAt: new Date() } as any)
		.where(eq(cloudProvider.providerId, providerId));

	return firewall.id;
}

/**
 * Create load balancer for a pool
 */
export async function createPoolLoadBalancer(
	providerId: string,
	poolId: string,
	config: {
		region: string;
		algorithm?: "round_robin" | "least_connections";
		healthCheck?: {
			protocol: "http" | "https" | "tcp";
			port: number;
			path?: string;
		};
	}
): Promise<string> {
	const client = await getClient(providerId);

	// Get all running instances in pool
	const instances = await db.query.provisionedInstance.findMany({
		where: and(
			eq(provisionedInstance.poolId, poolId),
			eq(provisionedInstance.status, "running")
		),
	});

	const dropletIds = instances
		.filter((d) => d.externalId)
		.map((d) => parseInt(d.externalId!));

	const { load_balancer } = await client.createLoadBalancer({
		name: `platform-lb-${poolId.slice(0, 8)}`,
		region: config.region,
		algorithm: config.algorithm || "round_robin",
		forwarding_rules: [
			{
				entry_protocol: "https",
				entry_port: 443,
				target_protocol: "http",
				target_port: 80,
				tls_passthrough: false,
			},
			{
				entry_protocol: "http",
				entry_port: 80,
				target_protocol: "http",
				target_port: 80,
			},
		],
		health_check: {
			protocol: config.healthCheck?.protocol || "http",
			port: config.healthCheck?.port || 80,
			path: config.healthCheck?.path || "/health",
			check_interval_seconds: 10,
			response_timeout_seconds: 5,
			unhealthy_threshold: 3,
			healthy_threshold: 5,
		},
		droplet_ids: dropletIds,
		tag: `pool:${poolId}`,
	});

	return load_balancer.id;
}

/**
 * List instances in a pool
 */
export async function listPoolInstances(poolId: string): Promise<ProvisionedInstance[]> {
	return db.query.provisionedInstance.findMany({
		where: eq(provisionedInstance.poolId, poolId),
		with: {
			computeNode: true,
		},
		orderBy: desc(provisionedInstance.createdAt),
	});
}

/**
 * Get scaling job status
 */
export async function getScalingJobStatus(jobId: string) {
	return db.query.scalingJob.findFirst({
		where: eq(scalingJob.jobId, jobId),
	});
}

// ============================================================================
// Backward Compatibility Aliases
// ============================================================================

/** @deprecated Use createInstance */
export const createDroplet = createInstance;
/** @deprecated Use deleteInstance */
export const deleteDroplet = deleteInstance;
/** @deprecated Use resizeInstance */
export const resizeDroplet = resizeInstance;
/** @deprecated Use listPoolInstances */
export const listPoolDroplets = listPoolInstances;
/** @deprecated Use listInstanceSizes */
export const listDropletSizes = listInstanceSizes;

// ============================================================================
// Helper Functions
// ============================================================================

function buildCloudInitScript(config: {
	nodeId: string;
	poolId: string;
	registrationToken: string;
	swarmManagerIp: string;
	platformApiUrl: string;
}): string {
	return `#cloud-config
package_update: true
package_upgrade: true

packages:
  - curl
  - wget
  - git
  - jq
  - unzip

write_files:
  - path: /etc/platform/node-config.json
    permissions: '0600'
    content: |
      {
        "nodeId": "${config.nodeId}",
        "poolId": "${config.poolId}",
        "platformApiUrl": "${config.platformApiUrl}",
        "registrationToken": "${config.registrationToken}",
        "swarmManagerIp": "${config.swarmManagerIp}"
      }

runcmd:
  - curl -fsSL https://get.docker.com | sh
  - systemctl enable docker
  - systemctl start docker
  - |
    CONFIG=$(cat /etc/platform/node-config.json)
    MANAGER_IP=$(echo $CONFIG | jq -r '.swarmManagerIp')
    if [ -n "$MANAGER_IP" ] && [ "$MANAGER_IP" != "null" ] && [ "$MANAGER_IP" != "" ]; then
      TOKEN=$(echo $CONFIG | jq -r '.registrationToken')
      API_URL=$(echo $CONFIG | jq -r '.platformApiUrl')
      JOIN_TOKEN=$(curl -s "$API_URL/api/pools/$(echo $CONFIG | jq -r '.poolId')/join-token" -H "Authorization: Bearer $TOKEN" | jq -r '.token')
      if [ -n "$JOIN_TOKEN" ] && [ "$JOIN_TOKEN" != "null" ]; then
        docker swarm join --token $JOIN_TOKEN $MANAGER_IP:2377
      fi
    fi
  - |
    CONFIG=$(cat /etc/platform/node-config.json)
    NODE_ID=$(echo $CONFIG | jq -r '.nodeId')
    API_URL=$(echo $CONFIG | jq -r '.platformApiUrl')
    TOKEN=$(echo $CONFIG | jq -r '.registrationToken')
    IP=$(curl -s https://ipinfo.io/ip)
    PRIVATE_IP=$(hostname -I | awk '{print $1}')
    curl -X POST "$API_URL/api/nodes/$NODE_ID/register" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\\"publicIp\\": \\"$IP\\", \\"privateIp\\": \\"$PRIVATE_IP\\", \\"hostname\\": \\"$(hostname)\\"}"

final_message: "Platform node bootstrap complete"`;
}

function getInstanceSpecs(size: string): {
	cpuCores: number;
	memoryMb: number;
	storageGb: number;
} {
	const sizeMap: Record<string, { cpuCores: number; memoryMb: number; storageGb: number }> = {
		"s-1vcpu-512mb-10gb": { cpuCores: 1, memoryMb: 512, storageGb: 10 },
		"s-1vcpu-1gb": { cpuCores: 1, memoryMb: 1024, storageGb: 25 },
		"s-1vcpu-2gb": { cpuCores: 1, memoryMb: 2048, storageGb: 50 },
		"s-2vcpu-2gb": { cpuCores: 2, memoryMb: 2048, storageGb: 60 },
		"s-2vcpu-4gb": { cpuCores: 2, memoryMb: 4096, storageGb: 80 },
		"s-4vcpu-8gb": { cpuCores: 4, memoryMb: 8192, storageGb: 160 },
		"s-8vcpu-16gb": { cpuCores: 8, memoryMb: 16384, storageGb: 320 },
		"s-16vcpu-32gb": { cpuCores: 16, memoryMb: 32768, storageGb: 640 },
		"g-2vcpu-8gb": { cpuCores: 2, memoryMb: 8192, storageGb: 25 },
		"g-4vcpu-16gb": { cpuCores: 4, memoryMb: 16384, storageGb: 50 },
		"g-8vcpu-32gb": { cpuCores: 8, memoryMb: 32768, storageGb: 100 },
		"gd-2vcpu-8gb": { cpuCores: 2, memoryMb: 8192, storageGb: 50 },
		"gd-4vcpu-16gb": { cpuCores: 4, memoryMb: 16384, storageGb: 100 },
		"m-2vcpu-16gb": { cpuCores: 2, memoryMb: 16384, storageGb: 50 },
		"m-4vcpu-32gb": { cpuCores: 4, memoryMb: 32768, storageGb: 100 },
	};
	return sizeMap[size] || { cpuCores: 1, memoryMb: 1024, storageGb: 25 };
}

async function waitForDropletStatus(
	client: DigitalOceanClient,
	dropletId: number,
	targetStatus: string,
	timeoutSeconds: number = 120
): Promise<void> {
	const startTime = Date.now();
	const pollInterval = 5000; // 5 seconds

	while (Date.now() - startTime < timeoutSeconds * 1000) {
		const { droplet } = await client.getDroplet(dropletId);
		if (droplet.status === targetStatus) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, pollInterval));
	}

	throw new Error(`Timeout waiting for instance ${dropletId} to reach status ${targetStatus}`);
}

async function recalculatePoolCapacity(poolId: string): Promise<void> {
	const nodes = await db.query.computeNode.findMany({
		where: and(
			eq(computeNode.poolId, poolId),
			eq(computeNode.status, "online")
		),
	});

	const totals = nodes.reduce(
		(acc, node) => ({
			cpuCores: acc.cpuCores + node.cpuCores,
			memoryMb: acc.memoryMb + node.memoryMb,
			storageGb: acc.storageGb + node.storageGb,
			gpuCount: acc.gpuCount + (node.gpuCount || 0),
		}),
		{ cpuCores: 0, memoryMb: 0, storageGb: 0, gpuCount: 0 }
	);

	await db
		.update(computePool)
		.set({
			totalCpuCores: totals.cpuCores,
			totalMemoryMb: totals.memoryMb,
			totalStorageGb: totals.storageGb,
			totalGpuCount: totals.gpuCount,
			availableCpuCores: totals.cpuCores, // Simplified - should track actual usage
			availableMemoryMb: totals.memoryMb,
			availableStorageGb: totals.storageGb,
			availableGpuCount: totals.gpuCount,
			totalNodes: nodes.length,
			activeNodes: nodes.length,
			updatedAt: new Date(),
		} as any)
		.where(eq(computePool.poolId, poolId));
}

// Export for use in other services
export { DigitalOceanClient, type DOSize, type DORegion };
