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
import { readFile } from "node:fs/promises";
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
import {
	findEnvironmentsByProjectId,
	findEnvironmentById,
} from "./environment";
import {
	createApplication,
	findApplicationById,
	updateApplication,
	deployApplication,
	rebuildApplication,
	getApplicationStats,
} from "./application";
import {
	createPostgres,
	findPostgresById,
	removePostgresById,
	deployPostgres,
} from "./postgres";
import {
	createMysql,
	findMySqlById,
	removeMySqlById,
	deployMySql,
} from "./mysql";
import {
	createMariadb,
	findMariadbById,
	removeMariadbById,
	deployMariadb,
} from "./mariadb";
import {
	createMongo,
	findMongoById,
	removeMongoById,
	deployMongo,
} from "./mongo";
import {
	createRedis,
	findRedisById,
	removeRedisById,
	deployRedis,
} from "./redis";
import {
	createDomain,
	findDomainsByApplicationId,
	findDomainsByComposeId,
	removeDomainById,
	validateDomain,
} from "./domain";
import {
	createCertificate,
	findCertificateById,
	removeCertificateById,
} from "./certificate";
import {
	createCompose,
	findComposeById,
	deployCompose,
	removeCompose,
	stopCompose,
	startCompose,
} from "./compose";
import {
	findServerById,
	getAllServers,
} from "./server";
import {
	getContainers,
	getConfig,
} from "./docker";
import {
	createBackup,
	findBackupById,
	findBackupsByDbId,
	removeBackupById,
} from "./backup";
import {
	findAllDeploymentsByApplicationId,
	findAllDeploymentsByComposeId,
} from "./deployment";
import { execAsync } from "@hanzo/platform/utils/process/execAsync";
import { db } from "@hanzo/platform/db";
import {
	applications,
	certificates,
	postgres,
	mysql,
	mariadb,
	mongo,
	redis,
	projects,
} from "@hanzo/platform/db/schema";
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
	// =========================================================================
	// PROJECT TOOLS
	// =========================================================================
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

	// =========================================================================
	// APPLICATION TOOLS
	// =========================================================================
	{
		name: "platform.create_app",
		description: "Create a new application in an environment",
		inputSchema: {
			type: "object",
			properties: {
				name: { type: "string", description: "Application display name" },
				appName: { type: "string", description: "Unique app name (slug)" },
				environmentId: { type: "string", description: "Environment ID" },
				description: { type: "string", description: "Application description" },
			},
			required: ["name", "appName", "environmentId"],
		},
		handler: async (args) => {
			return createApplication({
				name: args.name,
				appName: args.appName,
				environmentId: args.environmentId,
				description: args.description || "",
			} as any);
		},
	},
	{
		name: "platform.get_app",
		description: "Get full application details by ID, including domains, deployments, mounts",
		inputSchema: {
			type: "object",
			properties: {
				applicationId: { type: "string", description: "Application ID" },
			},
			required: ["applicationId"],
		},
		handler: async (args) => {
			return findApplicationById(args.applicationId);
		},
	},
	{
		name: "platform.update_app",
		description: "Update application settings (env vars, build args, source, etc.)",
		inputSchema: {
			type: "object",
			properties: {
				applicationId: { type: "string", description: "Application ID" },
				env: { type: "string", description: "Environment variables (KEY=VAL newline-separated)" },
				buildArgs: { type: "string", description: "Docker build args" },
				sourceType: { type: "string", description: "Source type: github, gitlab, docker, git, drop" },
				dockerImage: { type: "string", description: "Docker image (if sourceType=docker)" },
				repository: { type: "string", description: "Repository name" },
				branch: { type: "string", description: "Branch name" },
				buildPath: { type: "string", description: "Build path (e.g. /)" },
				publishDirectory: { type: "string", description: "Publish directory" },
				command: { type: "string", description: "Start command" },
				memoryLimit: { type: "number", description: "Memory limit in bytes" },
				cpuLimit: { type: "number", description: "CPU limit" },
				replicas: { type: "number", description: "Number of replicas" },
			},
			required: ["applicationId"],
		},
		handler: async (args) => {
			const { applicationId, ...updates } = args;
			// Filter out undefined values
			const filtered: Record<string, any> = {};
			for (const [k, v] of Object.entries(updates)) {
				if (v !== undefined) filtered[k] = v;
			}
			return updateApplication(applicationId, filtered);
		},
	},
	{
		name: "platform.delete_app",
		description: "Delete an application by ID",
		inputSchema: {
			type: "object",
			properties: {
				applicationId: { type: "string", description: "Application ID" },
			},
			required: ["applicationId"],
		},
		handler: async (args) => {
			const result = await db
				.delete(applications)
				.where(eq(applications.applicationId, args.applicationId))
				.returning();
			return result[0];
		},
	},
	{
		name: "platform.list_apps",
		description: "List all applications in an environment",
		inputSchema: {
			type: "object",
			properties: {
				environmentId: { type: "string", description: "Environment ID" },
			},
			required: ["environmentId"],
		},
		handler: async (args) => {
			const env = await findEnvironmentById(args.environmentId);
			return env.applications;
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
	{
		name: "platform.rebuild_app",
		description: "Force rebuild an application (reuse existing source, skip clone)",
		inputSchema: {
			type: "object",
			properties: {
				applicationId: { type: "string", description: "Application ID" },
				titleLog: { type: "string", description: "Rebuild log title" },
			},
			required: ["applicationId"],
		},
		handler: async (args) => {
			return rebuildApplication({
				applicationId: args.applicationId,
				titleLog: args.titleLog || "ZAP agent rebuild",
				descriptionLog: "",
			});
		},
	},
	{
		name: "platform.app_logs",
		description: "Get recent deployment logs for an application",
		inputSchema: {
			type: "object",
			properties: {
				applicationId: { type: "string", description: "Application ID" },
				lines: { type: "number", description: "Max lines to return (default 200)" },
			},
			required: ["applicationId"],
		},
		handler: async (args) => {
			const deploymentList = await findAllDeploymentsByApplicationId(args.applicationId);
			if (deploymentList.length === 0) {
				return { logs: "", message: "No deployments found" };
			}
			const latest = deploymentList[0];
			if (!latest || !latest.logPath) {
				return { logs: "", message: "No log path for latest deployment", deployment: latest };
			}
			try {
				const content = await readFile(latest.logPath, "utf-8");
				const maxLines = args.lines || 200;
				const lines = content.split("\n");
				const truncated = lines.slice(-maxLines).join("\n");
				return {
					deploymentId: latest.deploymentId,
					status: latest.status,
					logs: truncated,
					totalLines: lines.length,
				};
			} catch {
				return {
					deploymentId: latest.deploymentId,
					status: latest.status,
					logs: "",
					message: "Log file not readable (may be on remote server)",
				};
			}
		},
	},
	{
		name: "platform.app_stats",
		description: "Get live container stats (CPU, memory) for an application",
		inputSchema: {
			type: "object",
			properties: {
				appName: { type: "string", description: "Application appName (Docker service name)" },
			},
			required: ["appName"],
		},
		handler: async (args) => {
			return getApplicationStats(args.appName);
		},
	},

	// =========================================================================
	// DATABASE TOOLS - PostgreSQL
	// =========================================================================
	{
		name: "platform.create_postgres",
		description: "Create a new PostgreSQL database in an environment",
		inputSchema: {
			type: "object",
			properties: {
				name: { type: "string", description: "Display name" },
				appName: { type: "string", description: "Unique app name (slug)" },
				environmentId: { type: "string", description: "Environment ID" },
				databaseName: { type: "string", description: "Database name (default: same as appName)" },
				databaseUser: { type: "string", description: "Database user" },
				databasePassword: { type: "string", description: "Database password (auto-generated if empty)" },
				dockerImage: { type: "string", description: "Docker image (default: ghcr.io/hanzoai/sql:18)" },
			},
			required: ["name", "appName", "environmentId"],
		},
		handler: async (args) => {
			return createPostgres(args as any);
		},
	},
	{
		name: "platform.get_postgres",
		description: "Get PostgreSQL database details by ID",
		inputSchema: {
			type: "object",
			properties: {
				postgresId: { type: "string", description: "Postgres ID" },
			},
			required: ["postgresId"],
		},
		handler: async (args) => {
			return findPostgresById(args.postgresId);
		},
	},
	{
		name: "platform.deploy_postgres",
		description: "Deploy (start) a PostgreSQL database",
		inputSchema: {
			type: "object",
			properties: {
				postgresId: { type: "string", description: "Postgres ID" },
			},
			required: ["postgresId"],
		},
		handler: async (args) => {
			return deployPostgres(args.postgresId);
		},
	},
	{
		name: "platform.delete_postgres",
		description: "Delete a PostgreSQL database by ID",
		inputSchema: {
			type: "object",
			properties: {
				postgresId: { type: "string", description: "Postgres ID" },
			},
			required: ["postgresId"],
		},
		handler: async (args) => {
			return removePostgresById(args.postgresId);
		},
	},
	{
		name: "platform.list_postgres",
		description: "List all PostgreSQL databases in an environment",
		inputSchema: {
			type: "object",
			properties: {
				environmentId: { type: "string", description: "Environment ID" },
			},
			required: ["environmentId"],
		},
		handler: async (args) => {
			const env = await findEnvironmentById(args.environmentId);
			return env.postgres;
		},
	},

	// =========================================================================
	// DATABASE TOOLS - MySQL
	// =========================================================================
	{
		name: "platform.create_mysql",
		description: "Create a new MySQL database in an environment",
		inputSchema: {
			type: "object",
			properties: {
				name: { type: "string", description: "Display name" },
				appName: { type: "string", description: "Unique app name (slug)" },
				environmentId: { type: "string", description: "Environment ID" },
				databaseName: { type: "string", description: "Database name" },
				databaseUser: { type: "string", description: "Database user" },
				databasePassword: { type: "string", description: "Database password (auto-generated if empty)" },
				databaseRootPassword: { type: "string", description: "Root password (auto-generated if empty)" },
				dockerImage: { type: "string", description: "Docker image (default: ghcr.io/hanzoai/sql-mysql:8)" },
			},
			required: ["name", "appName", "environmentId"],
		},
		handler: async (args) => {
			return createMysql(args as any);
		},
	},
	{
		name: "platform.get_mysql",
		description: "Get MySQL database details by ID",
		inputSchema: {
			type: "object",
			properties: {
				mysqlId: { type: "string", description: "MySQL ID" },
			},
			required: ["mysqlId"],
		},
		handler: async (args) => {
			return findMySqlById(args.mysqlId);
		},
	},
	{
		name: "platform.deploy_mysql",
		description: "Deploy (start) a MySQL database",
		inputSchema: {
			type: "object",
			properties: {
				mysqlId: { type: "string", description: "MySQL ID" },
			},
			required: ["mysqlId"],
		},
		handler: async (args) => {
			return deployMySql(args.mysqlId);
		},
	},
	{
		name: "platform.delete_mysql",
		description: "Delete a MySQL database by ID",
		inputSchema: {
			type: "object",
			properties: {
				mysqlId: { type: "string", description: "MySQL ID" },
			},
			required: ["mysqlId"],
		},
		handler: async (args) => {
			return removeMySqlById(args.mysqlId);
		},
	},
	{
		name: "platform.list_mysql",
		description: "List all MySQL databases in an environment",
		inputSchema: {
			type: "object",
			properties: {
				environmentId: { type: "string", description: "Environment ID" },
			},
			required: ["environmentId"],
		},
		handler: async (args) => {
			const env = await findEnvironmentById(args.environmentId);
			return env.mysql;
		},
	},

	// =========================================================================
	// DATABASE TOOLS - MariaDB
	// =========================================================================
	{
		name: "platform.create_mariadb",
		description: "Create a new MariaDB database in an environment",
		inputSchema: {
			type: "object",
			properties: {
				name: { type: "string", description: "Display name" },
				appName: { type: "string", description: "Unique app name (slug)" },
				environmentId: { type: "string", description: "Environment ID" },
				databaseName: { type: "string", description: "Database name" },
				databaseUser: { type: "string", description: "Database user" },
				databasePassword: { type: "string", description: "Database password (auto-generated if empty)" },
				databaseRootPassword: { type: "string", description: "Root password (auto-generated if empty)" },
				dockerImage: { type: "string", description: "Docker image (default: ghcr.io/hanzoai/sql-maria:11)" },
			},
			required: ["name", "appName", "environmentId"],
		},
		handler: async (args) => {
			return createMariadb(args as any);
		},
	},
	{
		name: "platform.get_mariadb",
		description: "Get MariaDB database details by ID",
		inputSchema: {
			type: "object",
			properties: {
				mariadbId: { type: "string", description: "MariaDB ID" },
			},
			required: ["mariadbId"],
		},
		handler: async (args) => {
			return findMariadbById(args.mariadbId);
		},
	},
	{
		name: "platform.deploy_mariadb",
		description: "Deploy (start) a MariaDB database",
		inputSchema: {
			type: "object",
			properties: {
				mariadbId: { type: "string", description: "MariaDB ID" },
			},
			required: ["mariadbId"],
		},
		handler: async (args) => {
			return deployMariadb(args.mariadbId);
		},
	},
	{
		name: "platform.delete_mariadb",
		description: "Delete a MariaDB database by ID",
		inputSchema: {
			type: "object",
			properties: {
				mariadbId: { type: "string", description: "MariaDB ID" },
			},
			required: ["mariadbId"],
		},
		handler: async (args) => {
			return removeMariadbById(args.mariadbId);
		},
	},
	{
		name: "platform.list_mariadb",
		description: "List all MariaDB databases in an environment",
		inputSchema: {
			type: "object",
			properties: {
				environmentId: { type: "string", description: "Environment ID" },
			},
			required: ["environmentId"],
		},
		handler: async (args) => {
			const env = await findEnvironmentById(args.environmentId);
			return env.mariadb;
		},
	},

	// =========================================================================
	// DATABASE TOOLS - MongoDB
	// =========================================================================
	{
		name: "platform.create_mongo",
		description: "Create a new MongoDB database in an environment",
		inputSchema: {
			type: "object",
			properties: {
				name: { type: "string", description: "Display name" },
				appName: { type: "string", description: "Unique app name (slug)" },
				environmentId: { type: "string", description: "Environment ID" },
				databaseUser: { type: "string", description: "Database user" },
				databasePassword: { type: "string", description: "Database password (auto-generated if empty)" },
				dockerImage: { type: "string", description: "Docker image (default: ghcr.io/hanzoai/docdb:latest)" },
			},
			required: ["name", "appName", "environmentId"],
		},
		handler: async (args) => {
			return createMongo(args as any);
		},
	},
	{
		name: "platform.get_mongo",
		description: "Get MongoDB database details by ID",
		inputSchema: {
			type: "object",
			properties: {
				mongoId: { type: "string", description: "Mongo ID" },
			},
			required: ["mongoId"],
		},
		handler: async (args) => {
			return findMongoById(args.mongoId);
		},
	},
	{
		name: "platform.deploy_mongo",
		description: "Deploy (start) a MongoDB database",
		inputSchema: {
			type: "object",
			properties: {
				mongoId: { type: "string", description: "Mongo ID" },
			},
			required: ["mongoId"],
		},
		handler: async (args) => {
			return deployMongo(args.mongoId);
		},
	},
	{
		name: "platform.delete_mongo",
		description: "Delete a MongoDB database by ID",
		inputSchema: {
			type: "object",
			properties: {
				mongoId: { type: "string", description: "Mongo ID" },
			},
			required: ["mongoId"],
		},
		handler: async (args) => {
			return removeMongoById(args.mongoId);
		},
	},
	{
		name: "platform.list_mongo",
		description: "List all MongoDB databases in an environment",
		inputSchema: {
			type: "object",
			properties: {
				environmentId: { type: "string", description: "Environment ID" },
			},
			required: ["environmentId"],
		},
		handler: async (args) => {
			const env = await findEnvironmentById(args.environmentId);
			return env.mongo;
		},
	},

	// =========================================================================
	// DATABASE TOOLS - Redis
	// =========================================================================
	{
		name: "platform.create_redis",
		description: "Create a new Redis instance in an environment",
		inputSchema: {
			type: "object",
			properties: {
				name: { type: "string", description: "Display name" },
				appName: { type: "string", description: "Unique app name (slug)" },
				environmentId: { type: "string", description: "Environment ID" },
				databasePassword: { type: "string", description: "Redis password (auto-generated if empty)" },
				dockerImage: { type: "string", description: "Docker image (default: ghcr.io/hanzoai/kv:8)" },
			},
			required: ["name", "appName", "environmentId"],
		},
		handler: async (args) => {
			return createRedis(args as any);
		},
	},
	{
		name: "platform.get_redis",
		description: "Get Redis instance details by ID",
		inputSchema: {
			type: "object",
			properties: {
				redisId: { type: "string", description: "Redis ID" },
			},
			required: ["redisId"],
		},
		handler: async (args) => {
			return findRedisById(args.redisId);
		},
	},
	{
		name: "platform.deploy_redis",
		description: "Deploy (start) a Redis instance",
		inputSchema: {
			type: "object",
			properties: {
				redisId: { type: "string", description: "Redis ID" },
			},
			required: ["redisId"],
		},
		handler: async (args) => {
			return deployRedis(args.redisId);
		},
	},
	{
		name: "platform.delete_redis",
		description: "Delete a Redis instance by ID",
		inputSchema: {
			type: "object",
			properties: {
				redisId: { type: "string", description: "Redis ID" },
			},
			required: ["redisId"],
		},
		handler: async (args) => {
			return removeRedisById(args.redisId);
		},
	},
	{
		name: "platform.list_redis",
		description: "List all Redis instances in an environment",
		inputSchema: {
			type: "object",
			properties: {
				environmentId: { type: "string", description: "Environment ID" },
			},
			required: ["environmentId"],
		},
		handler: async (args) => {
			const env = await findEnvironmentById(args.environmentId);
			return env.redis;
		},
	},

	// =========================================================================
	// DOMAIN & CERTIFICATE TOOLS
	// =========================================================================
	{
		name: "platform.add_domain",
		description: "Add a custom domain to an application or compose service",
		inputSchema: {
			type: "object",
			properties: {
				host: { type: "string", description: "Domain hostname (e.g. app.example.com)" },
				https: { type: "boolean", description: "Enable HTTPS (default true)" },
				applicationId: { type: "string", description: "Application ID (provide this OR composeId)" },
				composeId: { type: "string", description: "Compose ID (provide this OR applicationId)" },
				port: { type: "number", description: "Target port (default 80)" },
				certificateId: { type: "string", description: "Certificate ID for custom TLS" },
			},
			required: ["host"],
		},
		handler: async (args) => {
			return createDomain({
				host: args.host,
				https: args.https !== false,
				applicationId: args.applicationId || null,
				composeId: args.composeId || null,
				port: args.port || null,
				certificateId: args.certificateId || null,
			} as any);
		},
	},
	{
		name: "platform.remove_domain",
		description: "Remove a custom domain by domain ID",
		inputSchema: {
			type: "object",
			properties: {
				domainId: { type: "string", description: "Domain ID" },
			},
			required: ["domainId"],
		},
		handler: async (args) => {
			return removeDomainById(args.domainId);
		},
	},
	{
		name: "platform.list_domains",
		description: "List domains for an application or compose service",
		inputSchema: {
			type: "object",
			properties: {
				applicationId: { type: "string", description: "Application ID" },
				composeId: { type: "string", description: "Compose ID" },
			},
		},
		handler: async (args) => {
			if (args.applicationId) {
				return findDomainsByApplicationId(args.applicationId);
			}
			if (args.composeId) {
				return findDomainsByComposeId(args.composeId);
			}
			return { error: "Provide applicationId or composeId" };
		},
	},
	{
		name: "platform.validate_domain",
		description: "Validate DNS resolution and optionally check expected IP",
		inputSchema: {
			type: "object",
			properties: {
				domain: { type: "string", description: "Domain to validate (e.g. app.example.com)" },
				expectedIp: { type: "string", description: "Expected IP address (optional)" },
			},
			required: ["domain"],
		},
		handler: async (args) => {
			return validateDomain(args.domain, args.expectedIp);
		},
	},
	{
		name: "platform.create_certificate",
		description: "Create/upload a custom SSL certificate",
		inputSchema: {
			type: "object",
			properties: {
				name: { type: "string", description: "Certificate display name" },
				certificateData: { type: "string", description: "PEM certificate chain" },
				privateKey: { type: "string", description: "PEM private key" },
				certificatePath: { type: "string", description: "Unique path name for storage" },
				organizationId: { type: "string", description: "Organization ID" },
				autoRenew: { type: "boolean", description: "Enable auto-renewal" },
			},
			required: ["name", "certificateData", "privateKey", "certificatePath", "organizationId"],
		},
		handler: async (args) => {
			const { organizationId, ...certData } = args;
			return createCertificate(certData as any, organizationId);
		},
	},
	{
		name: "platform.list_certificates",
		description: "List all certificates for an organization",
		inputSchema: {
			type: "object",
			properties: {
				organizationId: { type: "string", description: "Organization ID" },
			},
			required: ["organizationId"],
		},
		handler: async (args) => {
			const certs = await db.query.certificates.findMany({
				where: eq(certificates.organizationId, args.organizationId),
			});
			return certs;
		},
	},
	{
		name: "platform.delete_certificate",
		description: "Delete a certificate by ID",
		inputSchema: {
			type: "object",
			properties: {
				certificateId: { type: "string", description: "Certificate ID" },
			},
			required: ["certificateId"],
		},
		handler: async (args) => {
			return removeCertificateById(args.certificateId);
		},
	},

	// =========================================================================
	// COMPOSE (DOCKER COMPOSE) TOOLS
	// =========================================================================
	{
		name: "platform.create_compose",
		description: "Create a new Docker Compose service in an environment",
		inputSchema: {
			type: "object",
			properties: {
				name: { type: "string", description: "Display name" },
				appName: { type: "string", description: "Unique app name (slug)" },
				environmentId: { type: "string", description: "Environment ID" },
				composeFile: { type: "string", description: "Compose file content (for raw sourceType)" },
				sourceType: { type: "string", description: "Source type: github, gitlab, git, raw" },
				composeType: { type: "string", description: "docker-compose or stack" },
				repository: { type: "string", description: "Repository name" },
				branch: { type: "string", description: "Branch name" },
				composePath: { type: "string", description: "Path to compose file in repo" },
			},
			required: ["name", "appName", "environmentId"],
		},
		handler: async (args) => {
			return createCompose(args as any);
		},
	},
	{
		name: "platform.get_compose",
		description: "Get Docker Compose service details by ID",
		inputSchema: {
			type: "object",
			properties: {
				composeId: { type: "string", description: "Compose ID" },
			},
			required: ["composeId"],
		},
		handler: async (args) => {
			return findComposeById(args.composeId);
		},
	},
	{
		name: "platform.deploy_compose",
		description: "Deploy a Docker Compose service",
		inputSchema: {
			type: "object",
			properties: {
				composeId: { type: "string", description: "Compose ID" },
				titleLog: { type: "string", description: "Deployment log title" },
			},
			required: ["composeId"],
		},
		handler: async (args) => {
			return deployCompose({
				composeId: args.composeId,
				titleLog: args.titleLog || "ZAP agent compose deploy",
				descriptionLog: "",
			});
		},
	},
	{
		name: "platform.stop_compose",
		description: "Stop a running Docker Compose service",
		inputSchema: {
			type: "object",
			properties: {
				composeId: { type: "string", description: "Compose ID" },
			},
			required: ["composeId"],
		},
		handler: async (args) => {
			return stopCompose(args.composeId);
		},
	},
	{
		name: "platform.start_compose",
		description: "Start a stopped Docker Compose service",
		inputSchema: {
			type: "object",
			properties: {
				composeId: { type: "string", description: "Compose ID" },
			},
			required: ["composeId"],
		},
		handler: async (args) => {
			return startCompose(args.composeId);
		},
	},
	{
		name: "platform.delete_compose",
		description: "Delete a Docker Compose service (removes containers)",
		inputSchema: {
			type: "object",
			properties: {
				composeId: { type: "string", description: "Compose ID" },
				deleteVolumes: { type: "boolean", description: "Also delete volumes (default false)" },
			},
			required: ["composeId"],
		},
		handler: async (args) => {
			const composeObj = await findComposeById(args.composeId);
			await removeCompose(composeObj, args.deleteVolumes || false);
			// Also remove from DB
			const { compose } = await import("@hanzo/platform/db/schema");
			await db.delete(compose).where(eq(compose.composeId, args.composeId));
			return { deleted: true, composeId: args.composeId };
		},
	},
	{
		name: "platform.compose_logs",
		description: "Get recent deployment logs for a compose service",
		inputSchema: {
			type: "object",
			properties: {
				composeId: { type: "string", description: "Compose ID" },
				lines: { type: "number", description: "Max lines to return (default 200)" },
			},
			required: ["composeId"],
		},
		handler: async (args) => {
			const deploymentList = await findAllDeploymentsByComposeId(args.composeId);
			if (deploymentList.length === 0) {
				return { logs: "", message: "No deployments found" };
			}
			const latest = deploymentList[0];
			if (!latest || !latest.logPath) {
				return { logs: "", message: "No log path for latest deployment", deployment: latest };
			}
			try {
				const content = await readFile(latest.logPath, "utf-8");
				const maxLines = args.lines || 200;
				const lines = content.split("\n");
				const truncated = lines.slice(-maxLines).join("\n");
				return {
					deploymentId: latest.deploymentId,
					status: latest.status,
					logs: truncated,
					totalLines: lines.length,
				};
			} catch {
				return {
					deploymentId: latest.deploymentId,
					status: latest.status,
					logs: "",
					message: "Log file not readable (may be on remote server)",
				};
			}
		},
	},

	// =========================================================================
	// SERVER MANAGEMENT TOOLS
	// =========================================================================
	{
		name: "platform.list_servers",
		description: "List all remote servers registered in the platform",
		inputSchema: {
			type: "object",
			properties: {},
		},
		handler: async () => {
			return getAllServers();
		},
	},
	{
		name: "platform.get_server",
		description: "Get server details by ID (includes deployments, SSH key info)",
		inputSchema: {
			type: "object",
			properties: {
				serverId: { type: "string", description: "Server ID" },
			},
			required: ["serverId"],
		},
		handler: async (args) => {
			return findServerById(args.serverId);
		},
	},
	{
		name: "platform.validate_server",
		description: "Validate server connectivity by attempting SSH connection",
		inputSchema: {
			type: "object",
			properties: {
				serverId: { type: "string", description: "Server ID" },
			},
			required: ["serverId"],
		},
		handler: async (args) => {
			const { execAsyncRemote } = await import("@hanzo/platform/utils/process/execAsync");
			const server = await findServerById(args.serverId);
			try {
				const result = await execAsyncRemote(server.serverId, "echo ok && uname -a");
				return {
					reachable: true,
					ipAddress: server.ipAddress,
					output: result.stdout.trim(),
				};
			} catch (err: any) {
				return {
					reachable: false,
					ipAddress: server.ipAddress,
					error: err.message || String(err),
				};
			}
		},
	},

	// =========================================================================
	// DOCKER MANAGEMENT TOOLS
	// =========================================================================
	{
		name: "platform.list_containers",
		description: "List Docker containers on the platform host or a remote server",
		inputSchema: {
			type: "object",
			properties: {
				serverId: { type: "string", description: "Remote server ID (omit for local)" },
			},
		},
		handler: async (args) => {
			return getContainers(args.serverId || null);
		},
	},
	{
		name: "platform.container_config",
		description: "Get full Docker inspect config for a container",
		inputSchema: {
			type: "object",
			properties: {
				containerId: { type: "string", description: "Container ID" },
				serverId: { type: "string", description: "Remote server ID (omit for local)" },
			},
			required: ["containerId"],
		},
		handler: async (args) => {
			return getConfig(args.containerId, args.serverId || null);
		},
	},

	// =========================================================================
	// BACKUP & RESTORE TOOLS
	// =========================================================================
	{
		name: "platform.create_backup",
		description: "Create a database backup schedule/config",
		inputSchema: {
			type: "object",
			properties: {
				schedule: { type: "string", description: "Cron schedule expression" },
				enabled: { type: "boolean", description: "Enable backup schedule" },
				prefix: { type: "string", description: "Backup file prefix" },
				destinationId: { type: "string", description: "Backup destination ID" },
				postgresId: { type: "string", description: "Postgres ID (for postgres backups)" },
				mysqlId: { type: "string", description: "MySQL ID (for mysql backups)" },
				mariadbId: { type: "string", description: "MariaDB ID (for mariadb backups)" },
				mongoId: { type: "string", description: "Mongo ID (for mongo backups)" },
			},
			required: ["destinationId"],
		},
		handler: async (args) => {
			return createBackup(args as any);
		},
	},
	{
		name: "platform.get_backup",
		description: "Get backup details by ID",
		inputSchema: {
			type: "object",
			properties: {
				backupId: { type: "string", description: "Backup ID" },
			},
			required: ["backupId"],
		},
		handler: async (args) => {
			return findBackupById(args.backupId);
		},
	},
	{
		name: "platform.list_backups",
		description: "List backups for a specific database",
		inputSchema: {
			type: "object",
			properties: {
				databaseId: { type: "string", description: "Database ID (postgres/mysql/mariadb/mongo)" },
				databaseType: {
					type: "string",
					description: "Database type: postgres, mysql, mariadb, or mongo",
					enum: ["postgres", "mysql", "mariadb", "mongo"],
				},
			},
			required: ["databaseId", "databaseType"],
		},
		handler: async (args) => {
			return findBackupsByDbId(args.databaseId, args.databaseType);
		},
	},
	{
		name: "platform.delete_backup",
		description: "Delete a backup by ID",
		inputSchema: {
			type: "object",
			properties: {
				backupId: { type: "string", description: "Backup ID" },
			},
			required: ["backupId"],
		},
		handler: async (args) => {
			return removeBackupById(args.backupId);
		},
	},

	// =========================================================================
	// DOKS CLUSTER TOOLS
	// =========================================================================
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
			} as any);
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
		name: "platform.cluster_kubeconfig",
		description: "Get kubeconfig for a DOKS cluster",
		inputSchema: {
			type: "object",
			properties: {
				doksClusterId: { type: "string", description: "DOKS cluster ID" },
			},
			required: ["doksClusterId"],
		},
		handler: async (args) => {
			return getDoksKubeconfig(args.doksClusterId);
		},
	},
	{
		name: "platform.delete_cluster",
		description: "Delete a DOKS cluster",
		inputSchema: {
			type: "object",
			properties: {
				doksClusterId: { type: "string", description: "DOKS cluster ID" },
			},
			required: ["doksClusterId"],
		},
		handler: async (args) => {
			return deleteDoksCluster(args.doksClusterId);
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
	{
		name: "platform.add_node_pool",
		description: "Add a new node pool to a DOKS cluster",
		inputSchema: {
			type: "object",
			properties: {
				doksClusterId: { type: "string", description: "DOKS cluster ID" },
				name: { type: "string", description: "Pool name" },
				size: { type: "string", description: "Node size slug" },
				count: { type: "number", description: "Node count" },
			},
			required: ["doksClusterId", "name", "size", "count"],
		},
		handler: async (args) => {
			return addNodePool({
				doksClusterId: args.doksClusterId,
				name: args.name,
				size: args.size,
				count: args.count,
			} as any);
		},
	},
	{
		name: "platform.delete_node_pool",
		description: "Delete a node pool from a DOKS cluster",
		inputSchema: {
			type: "object",
			properties: {
				doksClusterId: { type: "string", description: "DOKS cluster ID" },
				poolId: { type: "string", description: "Node pool ID" },
			},
			required: ["doksClusterId", "poolId"],
		},
		handler: async (args) => {
			return deleteNodePool(args.doksClusterId, args.poolId);
		},
	},
	{
		name: "platform.upgrade_cluster_ha",
		description: "Upgrade a DOKS cluster to HA control plane",
		inputSchema: {
			type: "object",
			properties: {
				doksClusterId: { type: "string", description: "DOKS cluster ID" },
			},
			required: ["doksClusterId"],
		},
		handler: async (args) => {
			return upgradeToHA(args.doksClusterId);
		},
	},
	{
		name: "platform.list_node_sizes",
		description: "List available DOKS node sizes",
		inputSchema: {
			type: "object",
			properties: {},
		},
		handler: async () => {
			return listNodeSizes();
		},
	},
	{
		name: "platform.list_regions",
		description: "List available DigitalOcean regions",
		inputSchema: {
			type: "object",
			properties: {},
		},
		handler: async () => {
			return listRegions();
		},
	},

	// =========================================================================
	// K8S OPERATIONS TOOLS
	// =========================================================================
	{
		name: "platform.k8s_deploy",
		description: "Deploy a workload to a K8s cluster by applying a YAML manifest",
		inputSchema: {
			type: "object",
			properties: {
				doksClusterId: { type: "string", description: "DOKS cluster ID" },
				manifest: { type: "string", description: "YAML manifest content to apply" },
				namespace: { type: "string", description: "Target namespace (default: default)" },
			},
			required: ["doksClusterId", "manifest"],
		},
		handler: async (args) => {
			const kubeconfig = await getDoksKubeconfig(args.doksClusterId);
			const ns = args.namespace || "default";
			const tmpKubeconfig = `/tmp/zap-kubeconfig-${args.doksClusterId}`;
			const tmpManifest = `/tmp/zap-manifest-${Date.now()}.yaml`;
			const { writeFile, unlink } = await import("node:fs/promises");
			try {
				await writeFile(tmpKubeconfig, typeof kubeconfig === "string" ? kubeconfig : JSON.stringify(kubeconfig));
				await writeFile(tmpManifest, args.manifest);
				const result = await execAsync(
					`kubectl --kubeconfig=${tmpKubeconfig} apply -n ${ns} -f ${tmpManifest}`,
				);
				return { stdout: result.stdout, stderr: result.stderr };
			} finally {
				await unlink(tmpManifest).catch(() => {});
			}
		},
	},
	{
		name: "platform.k8s_status",
		description: "Get deployment/pod status in a K8s cluster",
		inputSchema: {
			type: "object",
			properties: {
				doksClusterId: { type: "string", description: "DOKS cluster ID" },
				namespace: { type: "string", description: "Namespace (default: default)" },
				resource: { type: "string", description: "Resource type (default: deployments)" },
				name: { type: "string", description: "Resource name (omit for all)" },
			},
			required: ["doksClusterId"],
		},
		handler: async (args) => {
			const kubeconfig = await getDoksKubeconfig(args.doksClusterId);
			const ns = args.namespace || "default";
			const resource = args.resource || "deployments";
			const tmpKubeconfig = `/tmp/zap-kubeconfig-${args.doksClusterId}`;
			const { writeFile } = await import("node:fs/promises");
			await writeFile(tmpKubeconfig, typeof kubeconfig === "string" ? kubeconfig : JSON.stringify(kubeconfig));
			const nameArg = args.name ? ` ${args.name}` : "";
			const result = await execAsync(
				`kubectl --kubeconfig=${tmpKubeconfig} get ${resource}${nameArg} -n ${ns} -o json`,
			);
			return JSON.parse(result.stdout);
		},
	},
	{
		name: "platform.k8s_scale",
		description: "Scale a K8s deployment to a target replica count",
		inputSchema: {
			type: "object",
			properties: {
				doksClusterId: { type: "string", description: "DOKS cluster ID" },
				deploymentName: { type: "string", description: "Deployment name" },
				namespace: { type: "string", description: "Namespace (default: default)" },
				replicas: { type: "number", description: "Target replica count" },
			},
			required: ["doksClusterId", "deploymentName", "replicas"],
		},
		handler: async (args) => {
			const kubeconfig = await getDoksKubeconfig(args.doksClusterId);
			const ns = args.namespace || "default";
			const tmpKubeconfig = `/tmp/zap-kubeconfig-${args.doksClusterId}`;
			const { writeFile } = await import("node:fs/promises");
			await writeFile(tmpKubeconfig, typeof kubeconfig === "string" ? kubeconfig : JSON.stringify(kubeconfig));
			const result = await execAsync(
				`kubectl --kubeconfig=${tmpKubeconfig} scale deployment/${args.deploymentName} --replicas=${args.replicas} -n ${ns}`,
			);
			return { stdout: result.stdout, stderr: result.stderr };
		},
	},
	{
		name: "platform.k8s_logs",
		description: "Get pod logs from a K8s cluster",
		inputSchema: {
			type: "object",
			properties: {
				doksClusterId: { type: "string", description: "DOKS cluster ID" },
				podName: { type: "string", description: "Pod name (or deployment name with deploy/ prefix)" },
				namespace: { type: "string", description: "Namespace (default: default)" },
				container: { type: "string", description: "Container name (for multi-container pods)" },
				tail: { type: "number", description: "Number of lines to tail (default 100)" },
				previous: { type: "boolean", description: "Get logs from previous container instance" },
			},
			required: ["doksClusterId", "podName"],
		},
		handler: async (args) => {
			const kubeconfig = await getDoksKubeconfig(args.doksClusterId);
			const ns = args.namespace || "default";
			const tail = args.tail || 100;
			const tmpKubeconfig = `/tmp/zap-kubeconfig-${args.doksClusterId}`;
			const { writeFile } = await import("node:fs/promises");
			await writeFile(tmpKubeconfig, typeof kubeconfig === "string" ? kubeconfig : JSON.stringify(kubeconfig));
			let cmd = `kubectl --kubeconfig=${tmpKubeconfig} logs ${args.podName} -n ${ns} --tail=${tail}`;
			if (args.container) cmd += ` -c ${args.container}`;
			if (args.previous) cmd += " --previous";
			const result = await execAsync(cmd);
			return { logs: result.stdout, stderr: result.stderr };
		},
	},
	{
		name: "platform.k8s_restart",
		description: "Restart a K8s deployment (rolling restart)",
		inputSchema: {
			type: "object",
			properties: {
				doksClusterId: { type: "string", description: "DOKS cluster ID" },
				deploymentName: { type: "string", description: "Deployment name" },
				namespace: { type: "string", description: "Namespace (default: default)" },
			},
			required: ["doksClusterId", "deploymentName"],
		},
		handler: async (args) => {
			const kubeconfig = await getDoksKubeconfig(args.doksClusterId);
			const ns = args.namespace || "default";
			const tmpKubeconfig = `/tmp/zap-kubeconfig-${args.doksClusterId}`;
			const { writeFile } = await import("node:fs/promises");
			await writeFile(tmpKubeconfig, typeof kubeconfig === "string" ? kubeconfig : JSON.stringify(kubeconfig));
			const result = await execAsync(
				`kubectl --kubeconfig=${tmpKubeconfig} rollout restart deployment/${args.deploymentName} -n ${ns}`,
			);
			return { stdout: result.stdout, stderr: result.stderr };
		},
	},
	{
		name: "platform.k8s_exec",
		description: "Execute a command in a K8s pod",
		inputSchema: {
			type: "object",
			properties: {
				doksClusterId: { type: "string", description: "DOKS cluster ID" },
				podName: { type: "string", description: "Pod name" },
				namespace: { type: "string", description: "Namespace (default: default)" },
				container: { type: "string", description: "Container name (for multi-container pods)" },
				command: { type: "string", description: "Command to execute" },
			},
			required: ["doksClusterId", "podName", "command"],
		},
		handler: async (args) => {
			const kubeconfig = await getDoksKubeconfig(args.doksClusterId);
			const ns = args.namespace || "default";
			const tmpKubeconfig = `/tmp/zap-kubeconfig-${args.doksClusterId}`;
			const { writeFile } = await import("node:fs/promises");
			await writeFile(tmpKubeconfig, typeof kubeconfig === "string" ? kubeconfig : JSON.stringify(kubeconfig));
			let cmd = `kubectl --kubeconfig=${tmpKubeconfig} exec ${args.podName} -n ${ns}`;
			if (args.container) cmd += ` -c ${args.container}`;
			cmd += ` -- ${args.command}`;
			const result = await execAsync(cmd);
			return { stdout: result.stdout, stderr: result.stderr };
		},
	},
	{
		name: "platform.k8s_delete",
		description: "Delete a K8s resource",
		inputSchema: {
			type: "object",
			properties: {
				doksClusterId: { type: "string", description: "DOKS cluster ID" },
				resource: { type: "string", description: "Resource type (e.g. deployment, service, pod)" },
				name: { type: "string", description: "Resource name" },
				namespace: { type: "string", description: "Namespace (default: default)" },
			},
			required: ["doksClusterId", "resource", "name"],
		},
		handler: async (args) => {
			const kubeconfig = await getDoksKubeconfig(args.doksClusterId);
			const ns = args.namespace || "default";
			const tmpKubeconfig = `/tmp/zap-kubeconfig-${args.doksClusterId}`;
			const { writeFile } = await import("node:fs/promises");
			await writeFile(tmpKubeconfig, typeof kubeconfig === "string" ? kubeconfig : JSON.stringify(kubeconfig));
			const result = await execAsync(
				`kubectl --kubeconfig=${tmpKubeconfig} delete ${args.resource} ${args.name} -n ${ns}`,
			);
			return { stdout: result.stdout, stderr: result.stderr };
		},
	},

	// =========================================================================
	// BILLING TOOLS
	// =========================================================================
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

	// =========================================================================
	// ADMIN / SYSTEM TOOLS
	// =========================================================================
	{
		name: "platform.system_status",
		description: "Get platform system status: server count, project count, cluster count",
		inputSchema: {
			type: "object",
			properties: {},
		},
		handler: async () => {
			const [servers, allProjects, clusters] = await Promise.all([
				getAllServers(),
				db.query.projects.findMany(),
				listDoksClusters(),
			]);
			return {
				servers: servers.length,
				projects: allProjects.length,
				clusters: Array.isArray(clusters) ? clusters.length : 0,
				status: "ok",
			};
		},
	},
	{
		name: "platform.cleanup_unused",
		description: "Identify unused resources (stopped containers, orphan volumes) on the platform host",
		inputSchema: {
			type: "object",
			properties: {
				serverId: { type: "string", description: "Remote server ID (omit for local)" },
				dryRun: { type: "boolean", description: "Only list, do not delete (default true)" },
			},
		},
		handler: async (args) => {
			const { execAsyncRemote } = await import("@hanzo/platform/utils/process/execAsync");
			const dryRun = args.dryRun !== false;
			const cmd = dryRun
				? "docker system df && echo '---VOLUMES---' && docker volume ls -f dangling=true"
				: "docker system prune -f && docker volume prune -f";
			let result;
			if (args.serverId) {
				result = await execAsyncRemote(args.serverId, cmd);
			} else {
				result = await execAsync(cmd);
			}
			return { dryRun, stdout: result.stdout, stderr: result.stderr };
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
	const listenPort = port || Number(process.env.ZAP_BRIDGE_PORT) || 9999;

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
