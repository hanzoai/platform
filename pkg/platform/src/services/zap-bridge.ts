/**
 * ZAP-to-Platform Service Bridge
 *
 * Exposes Platform operations to AI agents via a JSON-RPC HTTP server.
 * Each tool handler calls existing service functions directly.
 *
 * Authentication: Bearer token validated against ZAP_AUTH_TOKEN env var.
 * Default port: 9998 (configurable via ZAP_PORT).
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
	provisionDoksCluster,
	findDoksClusterById,
	findDoksClusterByOrgId,
	getDoksClusterStatus,
	getDoksKubeconfig,
	deleteDoksCluster,
	addNodePool,
	updateNodePool,
	deleteNodePool,
	upgradeToHA,
	listDoksClusters,
	syncDoksFleet,
	listNodeSizes,
	listRegions,
} from "./doks-provisioner";
import {
	calculateClusterCost,
	getOrgBilling,
	getFleetBilling,
	recordBillingSnapshot,
} from "./billing";
import {
	createProject,
	findProjectById,
	deleteProject,
} from "./project";
import { findEnvironmentsByProjectId } from "./environment";
import { deployApplication } from "./application";
import { db } from "@hanzo/platform/db";
import { projects } from "@hanzo/platform/db/schema";
import { eq } from "drizzle-orm";

// --- Tool definitions ---

interface ToolDef {
	name: string;
	description: string;
	inputSchema: {
		type: "object";
		properties: Record<string, any>;
		required?: string[];
	};
	handler: (args: any) => Promise<any>;
}

const tools: ToolDef[] = [
	// --- Project tools ---
	{
		name: "platform.list_projects",
		description: "List all projects for an organization",
		inputSchema: {
			type: "object",
			properties: {
				organizationId: { type: "string", description: "Organization ID" },
			},
			required: ["organizationId"],
		},
		handler: async (args) => {
			const allProjects = await db.query.projects.findMany({
				where: eq(projects.organizationId, args.organizationId),
				with: {
					environments: {
						with: {
							applications: true,
							postgres: true,
							mysql: true,
							mariadb: true,
							mongo: true,
							redis: true,
							compose: true,
						},
					},
				},
			});
			return allProjects;
		},
	},
	{
		name: "platform.create_project",
		description: "Create a new project with a production environment",
		inputSchema: {
			type: "object",
			properties: {
				name: { type: "string", description: "Project name" },
				description: { type: "string", description: "Project description" },
				organizationId: { type: "string", description: "Organization ID" },
			},
			required: ["name", "organizationId"],
		},
		handler: async (args) => {
			return createProject(
				{ name: args.name, description: args.description || "" },
				args.organizationId,
			);
		},
	},
	{
		name: "platform.delete_project",
		description: "Delete a project by ID",
		inputSchema: {
			type: "object",
			properties: {
				projectId: { type: "string", description: "Project ID" },
			},
			required: ["projectId"],
		},
		handler: async (args) => {
			return deleteProject(args.projectId);
		},
	},
	{
		name: "platform.list_environments",
		description: "List environments for a project",
		inputSchema: {
			type: "object",
			properties: {
				projectId: { type: "string", description: "Project ID" },
			},
			required: ["projectId"],
		},
		handler: async (args) => {
			return findEnvironmentsByProjectId(args.projectId);
		},
	},
	{
		name: "platform.deploy_app",
		description: "Trigger a deployment for an application",
		inputSchema: {
			type: "object",
			properties: {
				applicationId: { type: "string", description: "Application ID" },
				titleLog: { type: "string", description: "Deployment log title" },
				descriptionLog: { type: "string", description: "Deployment log description" },
			},
			required: ["applicationId"],
		},
		handler: async (args) => {
			return deployApplication({
				applicationId: args.applicationId,
				titleLog: args.titleLog || "ZAP agent deployment",
				descriptionLog: args.descriptionLog || "",
			});
		},
	},

	// --- DOKS cluster tools ---
	{
		name: "platform.list_clusters",
		description: "List all DOKS clusters across the fleet",
		inputSchema: {
			type: "object",
			properties: {},
		},
		handler: async () => {
			return listDoksClusters();
		},
	},
	{
		name: "platform.provision_cluster",
		description: "Provision a new DOKS Kubernetes cluster for an organization",
		inputSchema: {
			type: "object",
			properties: {
				organizationId: { type: "string", description: "Organization ID" },
				region: { type: "string", description: "DO region (e.g. sfo3, nyc1)" },
				nodeSize: { type: "string", description: "Node size slug (e.g. s-2vcpu-4gb)" },
				nodeCount: { type: "number", description: "Initial node count" },
				ha: { type: "boolean", description: "Enable HA control plane" },
			},
			required: ["organizationId"],
		},
		handler: async (args) => {
			return provisionDoksCluster({
				organizationId: args.organizationId,
				region: args.region,
				nodeSize: args.nodeSize,
				nodeCount: args.nodeCount,
				ha: args.ha,
			});
		},
	},
	{
		name: "platform.cluster_status",
		description: "Get live cluster status from DigitalOcean",
		inputSchema: {
			type: "object",
			properties: {
				doksClusterId: { type: "string", description: "DOKS cluster ID" },
			},
			required: ["doksClusterId"],
		},
		handler: async (args) => {
			return getDoksClusterStatus(args.doksClusterId);
		},
	},
	{
		name: "platform.scale_pool",
		description: "Update a node pool (count and/or size)",
		inputSchema: {
			type: "object",
			properties: {
				doksClusterId: { type: "string", description: "DOKS cluster ID" },
				poolId: { type: "string", description: "Node pool ID" },
				count: { type: "number", description: "Target node count" },
				size: { type: "string", description: "New node size slug" },
			},
			required: ["doksClusterId", "poolId"],
		},
		handler: async (args) => {
			return updateNodePool({
				doksClusterId: args.doksClusterId,
				poolId: args.poolId,
				count: args.count,
				size: args.size,
			});
		},
	},

	// --- Billing tools ---
	{
		name: "platform.org_billing",
		description: "Get billing breakdown for one organization",
		inputSchema: {
			type: "object",
			properties: {
				organizationId: { type: "string", description: "Organization ID" },
			},
			required: ["organizationId"],
		},
		handler: async (args) => {
			return getOrgBilling(args.organizationId);
		},
	},
	{
		name: "platform.fleet_billing",
		description: "Get fleet-wide billing summary across all organizations",
		inputSchema: {
			type: "object",
			properties: {},
		},
		handler: async () => {
			return getFleetBilling();
		},
	},
];

// --- Tool registry ---

const toolMap = new Map(tools.map((t) => [t.name, t]));

export function listTools() {
	return tools.map(({ name, description, inputSchema }) => ({
		name,
		description,
		inputSchema,
	}));
}

export async function callTool(name: string, args: Record<string, any> = {}) {
	const tool = toolMap.get(name);
	if (!tool) {
		return { error: `Unknown tool: ${name}`, isError: true };
	}
	try {
		const result = await tool.handler(args);
		return { data: result, isError: false };
	} catch (err: any) {
		return {
			error: err.message || String(err),
			code: err.code || "INTERNAL_ERROR",
			isError: true,
		};
	}
}

// --- HTTP JSON-RPC Server ---

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (c) => chunks.push(c));
		req.on("end", () => resolve(Buffer.concat(chunks).toString()));
		req.on("error", reject);
	});
}

function json(res: ServerResponse, status: number, data: any) {
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(JSON.stringify(data));
}

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
	// CORS
	res.setHeader("Access-Control-Allow-Origin", "*");
	res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
	res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
	if (req.method === "OPTIONS") {
		res.writeHead(204);
		return res.end();
	}

	// Auth
	const authToken = process.env.ZAP_AUTH_TOKEN;
	if (authToken) {
		const header = req.headers.authorization;
		if (!header || header !== `Bearer ${authToken}`) {
			return json(res, 401, { error: "Unauthorized" });
		}
	}

	// GET /tools — list available tools
	if (req.method === "GET" && req.url === "/tools") {
		return json(res, 200, { tools: listTools() });
	}

	// GET /health — health check
	if (req.method === "GET" && (req.url === "/health" || req.url === "/")) {
		return json(res, 200, { status: "ok", tools: tools.length });
	}

	// POST /call — invoke a tool
	if (req.method === "POST" && req.url === "/call") {
		const body = await readBody(req);
		let parsed: any;
		try {
			parsed = JSON.parse(body);
		} catch {
			return json(res, 400, { error: "Invalid JSON" });
		}

		const { name, arguments: args } = parsed;
		if (!name) {
			return json(res, 400, { error: "Missing 'name' field" });
		}

		const result = await callTool(name, args || {});
		return json(res, result.isError ? 400 : 200, result);
	}

	return json(res, 404, { error: "Not found" });
}

export function createPlatformZapServer(port?: number) {
	const listenPort = port || Number(process.env.ZAP_PORT) || 9998;

	const server = createServer(async (req, res) => {
		try {
			await handleRequest(req, res);
		} catch (err: any) {
			console.error("[ZAP] Request error:", err);
			json(res, 500, { error: "Internal server error" });
		}
	});

	server.listen(listenPort, () => {
		console.log(`[ZAP] Platform bridge listening on port ${listenPort}`);
		console.log(`[ZAP] ${tools.length} tools registered`);
	});

	return server;
}
