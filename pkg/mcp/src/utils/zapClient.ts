/**
 * ZAP Agent Bridge Client -- MCP to Platform communication over HTTP.
 *
 * This client talks to the JSON-RPC HTTP bridge (zap-bridge.ts), NOT the
 * native ZAP binary protocol. The native ZAP protocol uses Cap'n Proto
 * serialization over persistent TCP connections (port 9998, two-party
 * VatNetwork RPC). See pkg/zap/schema/platform.capnp for the wire schema.
 *
 * The bridge translates JSON-RPC requests into Cap'n Proto RPC calls
 * internally, so MCP tools get platform access without needing a capnp
 * client library.
 *
 * For the native Cap'n Proto client, see @hanzo/zap-client.
 *
 * Env vars:
 *   ZAP_URL        -- Bridge HTTP URL (e.g., http://localhost:9999)
 *   ZAP_AUTH_TOKEN  -- Bearer token for bridge auth (optional)
 */

import { createLogger } from "./logger.js";

const logger = createLogger("ZapClient");

interface ZapConfig {
  url: string;
  authToken?: string;
  timeout: number;
}

interface ZapResult<T = any> {
  data?: T;
  error?: string;
  code?: string;
  isError: boolean;
}

function getZapConfig(): ZapConfig | null {
  const url = process.env.ZAP_URL;
  if (!url) return null;

  return {
    url: url.replace(/\/$/, ""),
    authToken: process.env.ZAP_AUTH_TOKEN ?? "",
    timeout: parseInt(process.env.ZAP_TIMEOUT || "30000", 10),
  };
}

/**
 * Check if ZAP transport is available.
 */
export function isZapAvailable(): boolean {
  return !!process.env.ZAP_URL;
}

/**
 * Call a ZAP tool by name with arguments.
 */
export async function zapCall<T = any>(
  name: string,
  args: Record<string, any> = {}
): Promise<ZapResult<T>> {
  const config = getZapConfig();
  if (!config) {
    return { error: "ZAP_URL not configured", isError: true };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.authToken) {
    headers["Authorization"] = `Bearer ${config.authToken}`;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeout);

    const res = await fetch(`${config.url}/call`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name, arguments: args }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const result = (await res.json()) as ZapResult<T>;

    if (result.isError) {
      logger.error(`ZAP call failed: ${name}`, {
        error: result.error,
        code: result.code,
      });
    } else {
      logger.info(`ZAP call succeeded: ${name}`);
    }

    return result;
  } catch (err: any) {
    logger.error(`ZAP request error: ${name}`, { error: err.message });
    return {
      error: err.message || "ZAP request failed",
      isError: true,
    };
  }
}

/**
 * List all available ZAP tools.
 */
export async function zapListTools(): Promise<any[]> {
  const config = getZapConfig();
  if (!config) return [];

  try {
    const headers: Record<string, string> = {};
    if (config.authToken) {
      headers["Authorization"] = `Bearer ${config.authToken}`;
    }

    const res = await fetch(`${config.url}/tools`, { headers });
    const data = (await res.json()) as { tools: any[] };
    return data.tools || [];
  } catch {
    return [];
  }
}

/**
 * Health check for ZAP bridge.
 */
export async function zapHealth(): Promise<boolean> {
  const config = getZapConfig();
  if (!config) return false;

  try {
    const res = await fetch(`${config.url}/health`);
    const data = (await res.json()) as { status: string };
    return data.status === "ok";
  } catch {
    return false;
  }
}

/**
 * Mapping of MCP API paths to ZAP tool names.
 * When the MCP server would call `GET /v1/trpc/project.getAll`, it can instead
 * call `zapCall("platform.list_projects", { organizationId })`.
 */
export const MCP_TO_ZAP_MAP: Record<string, string> = {
  // Projects
  "project.all": "platform.list_projects",
  "project.one": "platform.get_project",
  "project.create": "platform.create_project",
  "project.delete": "platform.delete_project",

  // Applications
  "application.all": "platform.list_apps",
  "application.one": "platform.get_app",
  "application.create": "platform.create_app",
  "application.delete": "platform.delete_app",
  "application.deploy": "platform.deploy_app",
  "application.redeploy": "platform.rebuild_app",

  // Databases
  "postgres.all": "platform.list_postgres",
  "postgres.create": "platform.create_postgres",
  "postgres.delete": "platform.delete_postgres",
  "mysql.all": "platform.list_mysql",
  "mysql.create": "platform.create_mysql",
  "mysql.delete": "platform.delete_mysql",
  "mariadb.all": "platform.list_mariadb",
  "mariadb.create": "platform.create_mariadb",
  "mariadb.delete": "platform.delete_mariadb",
  "mongo.all": "platform.list_mongo",
  "mongo.create": "platform.create_mongo",
  "mongo.delete": "platform.delete_mongo",
  "redis.all": "platform.list_redis",
  "redis.create": "platform.create_redis",
  "redis.delete": "platform.delete_redis",

  // Compose
  "compose.all": "platform.list_compose",
  "compose.create": "platform.create_compose",
  "compose.delete": "platform.delete_compose",

  // Clusters
  "cluster.all": "platform.list_clusters",
  "cluster.provision": "platform.provision_cluster",
  "cluster.status": "platform.cluster_status",

  // K8s
  "k8s.deploy": "platform.k8s_deploy",
  "k8s.status": "platform.k8s_status",
  "k8s.scale": "platform.k8s_scale",
  "k8s.restart": "platform.k8s_restart",
};
