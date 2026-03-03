/**
 * Hanzo Cloud Deployment Service
 *
 * Handles deployment of applications to Hanzo Cloud infrastructure
 * instead of local Docker when configured for cloud mode.
 */

import { HANZO_CLOUD_CONFIG, isHanzoCloudEnabled } from "@/lib/hanzo-cloud-config";
import type { Application, Compose } from "@hanzo/platform";

interface DeploymentRequest {
  projectId: string;
  applicationId?: string;
  composeId?: string;
  environment: "production" | "staging" | "development";
  region: string;
  buildConfig: {
    dockerfile?: string;
    buildArgs?: Record<string, string>;
    context?: string;
  };
  resources: {
    cpu: number; // in millicores
    memory: number; // in MB
    disk: number; // in GB
  };
  scaling?: {
    minReplicas: number;
    maxReplicas: number;
    targetCPU: number;
  };
  envVars?: Record<string, string>;
}

interface DeploymentResponse {
  deploymentId: string;
  status: "pending" | "building" | "deploying" | "running" | "failed";
  url?: string;
  logs?: string[];
  error?: string;
}

export class HanzoCloudDeploymentService {
  private apiKey: string;
  private apiEndpoint: string;

  constructor() {
    this.apiKey = process.env.HANZO_CLOUD_API_KEY || "";
    this.apiEndpoint = HANZO_CLOUD_CONFIG.apiEndpoint;
  }

  /**
   * Deploy an application to Hanzo Cloud
   */
  async deployApplication(
    application: Application,
    options: Partial<DeploymentRequest> = {}
  ): Promise<DeploymentResponse> {
    if (!isHanzoCloudEnabled()) {
      throw new Error("Hanzo Cloud deployment is not enabled");
    }

    const deploymentRequest: DeploymentRequest = {
      projectId: application.projectId,
      applicationId: application.id,
      environment: options.environment || "production",
      region: options.region || "us-west-1",
      buildConfig: {
        dockerfile: application.dockerfile || "Dockerfile",
        buildArgs: application.buildArgs || {},
        context: application.buildContext || ".",
      },
      resources: {
        cpu: options.resources?.cpu || 500, // 0.5 CPU
        memory: options.resources?.memory || 512, // 512 MB
        disk: options.resources?.disk || 10, // 10 GB
      },
      scaling: options.scaling || HANZO_CLOUD_CONFIG.cloudFeatures.autoScaling,
      envVars: {
        ...application.env,
        ...options.envVars,
      },
    };

    return this.sendDeploymentRequest(deploymentRequest);
  }

  /**
   * Deploy a compose stack to Hanzo Cloud
   */
  async deployCompose(
    compose: Compose,
    options: Partial<DeploymentRequest> = {}
  ): Promise<DeploymentResponse> {
    if (!isHanzoCloudEnabled()) {
      throw new Error("Hanzo Cloud deployment is not enabled");
    }

    const deploymentRequest: DeploymentRequest = {
      projectId: compose.projectId,
      composeId: compose.id,
      environment: options.environment || "production",
      region: options.region || "us-west-1",
      buildConfig: {
        context: ".",
      },
      resources: {
        cpu: options.resources?.cpu || 2000, // 2 CPUs for compose stack
        memory: options.resources?.memory || 4096, // 4 GB
        disk: options.resources?.disk || 20, // 20 GB
      },
      envVars: {
        ...compose.env,
        ...options.envVars,
      },
    };

    return this.sendDeploymentRequest(deploymentRequest);
  }

  /**
   * Send deployment request to Hanzo Cloud API
   */
  private async sendDeploymentRequest(
    request: DeploymentRequest
  ): Promise<DeploymentResponse> {
    try {
      const response = await fetch(`${this.apiEndpoint}/v1/deployments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "X-Project-Id": request.projectId,
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Deployment failed: ${error}`);
      }

      const result = await response.json();
      return result as DeploymentResponse;
    } catch (error) {
      console.error("Hanzo Cloud deployment error:", error);
      return {
        deploymentId: "",
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get deployment status
   */
  async getDeploymentStatus(deploymentId: string): Promise<DeploymentResponse> {
    try {
      const response = await fetch(
        `${this.apiEndpoint}/v1/deployments/${deploymentId}`,
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to get deployment status`);
      }

      return await response.json();
    } catch (error) {
      return {
        deploymentId,
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Stream deployment logs
   */
  async streamLogs(
    deploymentId: string,
    onLog: (log: string) => void
  ): Promise<void> {
    const eventSource = new EventSource(
      `${this.apiEndpoint}/v1/deployments/${deploymentId}/logs?stream=true`,
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      }
    );

    eventSource.onmessage = (event) => {
      onLog(event.data);
    };

    eventSource.onerror = (error) => {
      console.error("Log streaming error:", error);
      eventSource.close();
    };

    // Close after 5 minutes
    setTimeout(() => eventSource.close(), 5 * 60 * 1000);
  }

  /**
   * Cancel a deployment
   */
  async cancelDeployment(deploymentId: string): Promise<void> {
    await fetch(`${this.apiEndpoint}/v1/deployments/${deploymentId}/cancel`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });
  }

  /**
   * Get deployment metrics
   */
  async getMetrics(deploymentId: string): Promise<any> {
    const response = await fetch(
      `${this.apiEndpoint}/v1/deployments/${deploymentId}/metrics`,
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error("Failed to get deployment metrics");
    }

    return response.json();
  }
}

// Export singleton instance
export const hanzoCloudDeployment = new HanzoCloudDeploymentService();