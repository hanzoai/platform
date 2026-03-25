/**
 * Deployment Router
 *
 * Routes deployments to either local Docker or Hanzo Cloud
 * based on configuration and user selection.
 */

import { deployApplication as dockerDeploy } from "@hanzo/platform";
import { hanzoCloudDeployment } from "../services/hanzo-cloud-deployment";
import { isHanzoCloudEnabled } from "@/lib/hanzo-cloud-config";
import type { Application, Compose } from "@hanzo/platform";

interface DeploymentOptions {
  target: "local" | "cloud";
  region?: string;
  environment?: "production" | "staging" | "development";
  resources?: {
    cpu: number;
    memory: number;
    disk: number;
  };
}

/**
 * Route application deployment to appropriate target
 */
export async function routeApplicationDeployment(
  application: Application,
  options: DeploymentOptions = { target: "local" }
) {
  const app = application as any;

  try {
    if (options.target === "cloud" && isHanzoCloudEnabled()) {
      // Deploy to Hanzo Cloud
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
    } else {
      // Deploy to local Docker
      await dockerDeploy(application as any);

      return {
        success: true,
        deploymentId: `local-${app.applicationId || app.id}-${Date.now()}`,
        url: `https://${application.appName}.${process.env.DOMAIN}`,
        message: "Deployed to local Docker",
      };
    }
  } catch (error) {
    console.error(`Deployment failed for ${application.name}:`, error);
    throw error;
  }
}

/**
 * Route compose deployment to appropriate target
 */
export async function routeComposeDeployment(
  compose: Compose,
  options: DeploymentOptions = { target: "local" }
) {
  const c = compose as any;

  try {
    if (options.target === "cloud" && isHanzoCloudEnabled()) {
      // Deploy to Hanzo Cloud
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
    } else {
      // Deploy to local Docker using docker-compose
      const { deployCompose } = await import("@hanzo/platform");
      await deployCompose(compose as any);

      return {
        success: true,
        deploymentId: `local-compose-${c.composeId || c.id}-${Date.now()}`,
        url: `https://${compose.appName}.${process.env.DOMAIN}`,
        message: "Deployed compose stack to local Docker",
      };
    }
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
  target: "local" | "cloud" = "local"
): Promise<string[]> {
  if (target === "cloud") {
    const response = await hanzoCloudDeployment.getDeploymentStatus(deploymentId);
    return response.logs || [];
  } else {
    // Get Docker logs
    const { execAsync } = await import("@hanzo/platform");
    const result = await execAsync(`docker logs ${deploymentId} --tail 100`);
    return result.stdout.split("\n");
  }
}

/**
 * Cancel deployment
 */
export async function cancelDeployment(
  deploymentId: string,
  target: "local" | "cloud" = "local"
): Promise<void> {
  if (target === "cloud") {
    await hanzoCloudDeployment.cancelDeployment(deploymentId);
  } else {
    // Stop Docker container
    const { execAsync } = await import("@hanzo/platform");
    await execAsync(`docker stop ${deploymentId}`);
  }
}

/**
 * Get deployment status
 */
export async function getDeploymentStatus(
  deploymentId: string,
  target: "local" | "cloud" = "local"
) {
  if (target === "cloud") {
    return await hanzoCloudDeployment.getDeploymentStatus(deploymentId);
  } else {
    // Check Docker container status
    const { execAsync } = await import("@hanzo/platform");
    try {
      const result = await execAsync(
        `docker inspect ${deploymentId} --format='{{.State.Status}}'`
      );
      return {
        deploymentId,
        status: result.stdout.trim() as any,
      };
    } catch {
      return {
        deploymentId,
        status: "not found",
      };
    }
  }
}