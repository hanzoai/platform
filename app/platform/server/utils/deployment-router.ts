/**
 * Deployment Router
 *
 * Routes deployments to one of three targets:
 *  - local — Docker / Docker Swarm (Dokploy default)
 *  - cloud — Hanzo Cloud (managed Hanzo PaaS)
 *  - k8s   — direct Kubernetes (Agnost graft: namespace per env,
 *            Deployment + Service + Ingress + optional HPA/PVC)
 *
 * Each Application carries a `deployTarget` column (PR 3 of the
 * Agnost graft series). When unset, falls back to the per-call
 * `options.target` and finally to "local".
 */

import { deployApplication as dockerDeploy } from "@hanzo/platform";
import {
  deployApplication as k8sDeploy,
  teardownApplication as k8sTeardown,
  getApplicationStatus as k8sStatus,
  type ApplicationSpec,
} from "@hanzo/platform/services/k8s";
import { hanzoCloudDeployment } from "../services/hanzo-cloud-deployment";
import { isHanzoCloudEnabled } from "@/lib/hanzo-cloud-config";
import type { Application, Compose } from "@hanzo/platform";

export type DeployTarget = "local" | "cloud" | "k8s";

interface DeploymentOptions {
  target: DeployTarget;
  region?: string;
  environment?: "production" | "staging" | "development";
  resources?: {
    cpu: number;
    memory: number;
    disk: number;
  };
  /**
   * K8s-only — when target=="k8s". Caller must pass these.
   * namespace: target namespace (default: derived from environment).
   * kubeconfig: optional kubeconfig string (default: in-cluster auth).
   */
  k8s?: {
    namespace?: string;
    kubeconfig?: string;
    hosts?: string[];
    tls?: Array<{ hosts: string[]; secretName?: string }>;
  };
}

/**
 * Derive the K8s namespace for an environment when not explicitly set.
 * Mirrors Agnost's namespace-per-environment convention.
 */
function deriveK8sNamespace(application: Application & { environmentId?: string }, options: DeploymentOptions): string {
  if (options.k8s?.namespace) return options.k8s.namespace;
  if (application.environmentId) return application.environmentId;
  const env = options.environment ?? "production";
  return `${(application as { appName?: string }).appName ?? "default"}-${env}`;
}

/**
 * Translate the Dokploy Application row into the Agnost-style ApplicationSpec
 * expected by services/k8s/deployApplication.
 */
function toApplicationSpec(application: Application, options: DeploymentOptions): ApplicationSpec {
  const a = application as Application & {
    appName: string;
    dockerImage?: string;
    ports?: Array<{ targetPort?: number; publishedPort?: number }>;
    env?: string;
    cpuRequest?: string;
    cpuLimit?: string;
    memoryReservation?: string;
    memoryLimit?: string;
    replicas?: number;
  };

  const envPairs: Array<{ name: string; value: string }> = [];
  if (a.env) {
    for (const line of a.env.split("\n")) {
      const eq = line.indexOf("=");
      if (eq > 0) {
        envPairs.push({ name: line.slice(0, eq).trim(), value: line.slice(eq + 1) });
      }
    }
  }

  const containerPort = a.ports?.[0]?.targetPort ?? a.ports?.[0]?.publishedPort ?? 3000;

  return {
    name: a.appName,
    image: a.dockerImage ?? `${a.appName}:latest`,
    containerPort,
    replicas: a.replicas ?? options.resources?.cpu ?? 1,
    env: envPairs.length > 0 ? envPairs : undefined,
    resources:
      a.cpuRequest || a.cpuLimit || a.memoryReservation || a.memoryLimit
        ? {
            cpuRequest: a.cpuRequest,
            cpuLimit: a.cpuLimit,
            memoryRequest: a.memoryReservation,
            memoryLimit: a.memoryLimit,
          }
        : undefined,
    labels: {
      "app.kubernetes.io/name": a.appName,
      "app.kubernetes.io/managed-by": "hanzo-platform",
    },
    hosts: options.k8s?.hosts,
    tls: options.k8s?.tls,
  };
}

/**
 * Route application deployment to appropriate target
 */
export async function routeApplicationDeployment(
  application: Application,
  options: DeploymentOptions = { target: "local" },
) {
  const app = application as Application & {
    applicationId?: string;
    id?: string;
    deployTarget?: DeployTarget;
  };

  // Application-row target overrides per-call default when set.
  const effectiveTarget: DeployTarget = app.deployTarget ?? options.target;

  try {
    if (effectiveTarget === "k8s") {
      const namespace = deriveK8sNamespace(application, options);
      const spec = toApplicationSpec(application, options);
      await k8sDeploy(namespace, spec, options.k8s?.kubeconfig);
      const url = options.k8s?.hosts?.[0]
        ? `https://${options.k8s.hosts[0]}`
        : `https://${spec.name}.${process.env.DOMAIN}`;
      return {
        success: true,
        deploymentId: `k8s-${namespace}-${spec.name}`,
        url,
        message: `Deployed to Kubernetes (${namespace})`,
      };
    }

    if (effectiveTarget === "cloud" && isHanzoCloudEnabled()) {
      const result = await hanzoCloudDeployment.deployApplication(application, {
        environment: options.environment || "production",
        region: options.region || process.env.DEFAULT_REGION || "us-west-1",
        resources: options.resources,
      });
      return {
        success: result.status !== "failed",
        deploymentId: result.deploymentId,
        url: result.url,
        message: `Deployed to Hanzo Cloud (${options.region})`,
      };
    }

    // Default: local Docker / Swarm
    await dockerDeploy(application as Parameters<typeof dockerDeploy>[0]);
    return {
      success: true,
      deploymentId: `local-${app.applicationId || app.id}-${Date.now()}`,
      url: `https://${application.appName}.${process.env.DOMAIN}`,
      message: "Deployed to local Docker",
    };
  } catch (error) {
    console.error(`Deployment failed for ${application.name}:`, error);
    throw error;
  }
}

/**
 * Route compose deployment to appropriate target.
 *
 * Compose stacks don't yet have a K8s path — that maps to Helm or a
 * pre-rendered template stack and lands in a follow-up. For now,
 * k8s target on a Compose falls through to local Docker.
 */
export async function routeComposeDeployment(
  compose: Compose,
  options: DeploymentOptions = { target: "local" },
) {
  const c = compose as Compose & { composeId?: string; id?: string };

  try {
    if (options.target === "cloud" && isHanzoCloudEnabled()) {
      const result = await hanzoCloudDeployment.deployCompose(compose, {
        environment: options.environment || "production",
        region: options.region || process.env.DEFAULT_REGION || "us-west-1",
        resources: options.resources,
      });
      return {
        success: result.status !== "failed",
        deploymentId: result.deploymentId,
        url: result.url,
        message: `Deployed compose stack to Hanzo Cloud (${options.region})`,
      };
    }

    const { deployCompose } = await import("@hanzo/platform");
    await deployCompose(compose as Parameters<typeof deployCompose>[0]);
    return {
      success: true,
      deploymentId: `local-compose-${c.composeId || c.id}-${Date.now()}`,
      url: `https://${compose.appName}.${process.env.DOMAIN}`,
      message: "Deployed compose stack to local Docker",
    };
  } catch (error) {
    console.error(`Compose deployment failed for ${compose.name}:`, error);
    throw error;
  }
}

/**
 * Get deployment logs
 */
export async function getDeploymentLogs(
  deploymentId: string,
  target: DeployTarget = "local",
): Promise<string[]> {
  if (target === "cloud") {
    const response = await hanzoCloudDeployment.getDeploymentStatus(deploymentId);
    return response.logs || [];
  }
  if (target === "k8s") {
    // Logs for K8s deployments are streamed via the K8s pod log API.
    // Wire up in PR 4 — for now, return a placeholder so callers don't crash.
    return [`[k8s] log streaming not yet wired for deployment ${deploymentId}`];
  }
  const { execAsync } = await import("@hanzo/platform");
  const result = await execAsync(`docker logs ${deploymentId} --tail 100`);
  return result.stdout.split("\n");
}

/**
 * Cancel deployment
 */
export async function cancelDeployment(
  deploymentId: string,
  target: DeployTarget = "local",
): Promise<void> {
  if (target === "cloud") {
    await hanzoCloudDeployment.cancelDeployment(deploymentId);
    return;
  }
  if (target === "k8s") {
    // deploymentId format: k8s-<namespace>-<name>
    const m = deploymentId.match(/^k8s-(.+)-([^-]+)$/);
    if (!m) {
      throw new Error(`Invalid K8s deploymentId: ${deploymentId}`);
    }
    const [, namespace, name] = m;
    await k8sTeardown(namespace, name);
    return;
  }
  const { execAsync } = await import("@hanzo/platform");
  await execAsync(`docker stop ${deploymentId}`);
}

/**
 * Get deployment status
 */
export async function getDeploymentStatus(
  deploymentId: string,
  target: DeployTarget = "local",
) {
  if (target === "cloud") {
    return await hanzoCloudDeployment.getDeploymentStatus(deploymentId);
  }
  if (target === "k8s") {
    const m = deploymentId.match(/^k8s-(.+)-([^-]+)$/);
    if (!m) {
      return { deploymentId, status: "invalid-id" };
    }
    const [, namespace, name] = m;
    try {
      const status = await k8sStatus(namespace, name);
      return { deploymentId, status };
    } catch {
      return { deploymentId, status: "not found" };
    }
  }
  const { execAsync } = await import("@hanzo/platform");
  try {
    const result = await execAsync(
      `docker inspect ${deploymentId} --format='{{.State.Status}}'`,
    );
    return {
      deploymentId,
      status: result.stdout.trim(),
    };
  } catch {
    return {
      deploymentId,
      status: "not found",
    };
  }
}
