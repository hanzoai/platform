/**
 * Hanzo Blockchain Infrastructure Integration
 *
 * Integrates the platform with Hanzo's blockchain nodes for deployment
 * instead of using traditional Docker Compose infrastructure.
 */

export interface BlockchainNode {
  id: string;
  name: string;
  endpoint: string;
  region: string;
  type: "validator" | "worker" | "storage";
  status: "online" | "offline" | "syncing";
  resources: {
    cpu: number;
    memory: number;
    storage: number;
    gpu?: number;
  };
}

export interface BlockchainDeployment {
  id: string;
  name: string;
  nodeId: string;
  spec: ComposeSpec; // New Compose Spec format
  status: "pending" | "deploying" | "running" | "stopped" | "failed";
  endpoints: string[];
  resources: {
    cpu: number;
    memory: number;
    storage: number;
  };
  metadata: {
    createdAt: Date;
    updatedAt: Date;
    version: string;
  };
}

export interface ComposeSpec {
  version: "3.0"; // New Compose Spec version
  name: string;
  services: Record<string, ServiceSpec>;
  networks?: Record<string, NetworkSpec>;
  volumes?: Record<string, VolumeSpec>;
  configs?: Record<string, ConfigSpec>;
  secrets?: Record<string, SecretSpec>;
}

export interface ServiceSpec {
  image: string;
  command?: string | string[];
  entrypoint?: string | string[];
  environment?: Record<string, string>;
  ports?: string[];
  volumes?: string[];
  networks?: string[];
  deploy?: {
    replicas?: number;
    resources?: {
      limits?: {
        cpus?: string;
        memory?: string;
      };
      reservations?: {
        cpus?: string;
        memory?: string;
      };
    };
    placement?: {
      constraints?: string[];
    };
  };
  depends_on?: string[] | Record<string, { condition: string }>;
  healthcheck?: {
    test: string | string[];
    interval?: string;
    timeout?: string;
    retries?: number;
    start_period?: string;
  };
  labels?: Record<string, string>;
  restart?: "no" | "always" | "on-failure" | "unless-stopped";
}

export interface NetworkSpec {
  driver?: string;
  driver_opts?: Record<string, string>;
  ipam?: {
    driver?: string;
    config?: Array<{
      subnet?: string;
      gateway?: string;
    }>;
  };
  external?: boolean;
  attachable?: boolean;
  internal?: boolean;
}

export interface VolumeSpec {
  driver?: string;
  driver_opts?: Record<string, string>;
  external?: boolean;
  labels?: Record<string, string>;
}

export interface ConfigSpec {
  file?: string;
  external?: boolean;
  name?: string;
}

export interface SecretSpec {
  file?: string;
  external?: boolean;
  name?: string;
}

export class HanzoBlockchainInfra {
  private nodes: BlockchainNode[] = [];
  private deployments: Map<string, BlockchainDeployment> = new Map();

  constructor() {
    this.initializeNodes();
  }

  private async initializeNodes() {
    // Initialize connection to Hanzo blockchain nodes
    const nodesConfig = process.env.HANZO_BLOCKCHAIN_NODES || "";
    if (nodesConfig) {
      this.nodes = JSON.parse(nodesConfig);
    } else {
      // Default nodes for development
      this.nodes = [
        {
          id: "node-1",
          name: "Primary Validator",
          endpoint: "https://node1.hanzo.ai",
          region: "us-west-1",
          type: "validator",
          status: "online",
          resources: {
            cpu: 32,
            memory: 128000,
            storage: 2000,
            gpu: 4,
          },
        },
        {
          id: "node-2",
          name: "Worker Node 1",
          endpoint: "https://node2.hanzo.ai",
          region: "us-west-1",
          type: "worker",
          status: "online",
          resources: {
            cpu: 16,
            memory: 64000,
            storage: 1000,
          },
        },
      ];
    }
  }

  /**
   * Get available blockchain nodes
   */
  async getNodes(): Promise<BlockchainNode[]> {
    // Check node status
    for (const node of this.nodes) {
      node.status = await this.checkNodeStatus(node);
    }
    return this.nodes;
  }

  /**
   * Check node status
   */
  private async checkNodeStatus(node: BlockchainNode): Promise<"online" | "offline" | "syncing"> {
    try {
      const response = await fetch(`${node.endpoint}/health`);
      if (response.ok) {
        const data = await response.json();
        return data.syncing ? "syncing" : "online";
      }
      return "offline";
    } catch {
      return "offline";
    }
  }

  /**
   * Deploy compose spec to blockchain node
   */
  async deployToBlockchain(
    spec: ComposeSpec,
    nodeId: string,
    options: {
      name: string;
      namespace?: string;
      environment?: "production" | "staging" | "development";
    }
  ): Promise<BlockchainDeployment> {
    const node = this.nodes.find(n => n.id === nodeId);
    if (!node) {
      throw new Error(`Node ${nodeId} not found`);
    }

    if (node.status !== "online") {
      throw new Error(`Node ${nodeId} is not online`);
    }

    // Calculate required resources
    const resources = this.calculateResources(spec);

    // Check if node has enough resources
    if (!this.hasEnoughResources(node, resources)) {
      throw new Error(`Node ${nodeId} does not have enough resources`);
    }

    // Create deployment
    const deployment: BlockchainDeployment = {
      id: `deploy-${Date.now()}`,
      name: options.name,
      nodeId,
      spec,
      status: "deploying",
      endpoints: [],
      resources,
      metadata: {
        createdAt: new Date(),
        updatedAt: new Date(),
        version: "1.0.0",
      },
    };

    // Send deployment to blockchain node
    const response = await fetch(`${node.endpoint}/deploy`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.HANZO_NODE_API_KEY}`,
      },
      body: JSON.stringify({
        spec,
        options,
      }),
    });

    if (!response.ok) {
      deployment.status = "failed";
      throw new Error(`Deployment failed: ${await response.text()}`);
    }

    const result = await response.json();
    deployment.status = "running";
    deployment.endpoints = result.endpoints;

    this.deployments.set(deployment.id, deployment);
    return deployment;
  }

  /**
   * Calculate required resources for compose spec
   */
  private calculateResources(spec: ComposeSpec): { cpu: number; memory: number; storage: number } {
    let totalCpu = 0;
    let totalMemory = 0;
    let totalStorage = 10; // Base storage

    for (const service of Object.values(spec.services)) {
      const replicas = service.deploy?.replicas || 1;

      // Parse CPU (e.g., "0.5", "500m")
      const cpuLimit = service.deploy?.resources?.limits?.cpus;
      if (cpuLimit) {
        const cpu = cpuLimit.endsWith("m")
          ? parseInt(cpuLimit) / 1000
          : parseFloat(cpuLimit);
        totalCpu += cpu * replicas;
      } else {
        totalCpu += 0.5 * replicas; // Default 0.5 CPU per service
      }

      // Parse memory (e.g., "512M", "1G")
      const memLimit = service.deploy?.resources?.limits?.memory;
      if (memLimit) {
        let memory = 0;
        if (memLimit.endsWith("G")) {
          memory = parseFloat(memLimit) * 1024;
        } else if (memLimit.endsWith("M")) {
          memory = parseFloat(memLimit);
        }
        totalMemory += memory * replicas;
      } else {
        totalMemory += 512 * replicas; // Default 512MB per service
      }

      // Add storage for volumes
      if (service.volumes) {
        totalStorage += service.volumes.length * 5; // 5GB per volume
      }
    }

    return {
      cpu: Math.ceil(totalCpu),
      memory: Math.ceil(totalMemory),
      storage: totalStorage,
    };
  }

  /**
   * Check if node has enough resources
   */
  private hasEnoughResources(
    node: BlockchainNode,
    required: { cpu: number; memory: number; storage: number }
  ): boolean {
    // Get current usage from node
    // For now, assume 50% usage
    const availableCpu = node.resources.cpu * 0.5;
    const availableMemory = node.resources.memory * 0.5;
    const availableStorage = node.resources.storage * 0.5;

    return (
      required.cpu <= availableCpu &&
      required.memory <= availableMemory &&
      required.storage <= availableStorage
    );
  }

  /**
   * Get deployment status
   */
  async getDeployment(deploymentId: string): Promise<BlockchainDeployment | undefined> {
    return this.deployments.get(deploymentId);
  }

  /**
   * Stop deployment
   */
  async stopDeployment(deploymentId: string): Promise<void> {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment ${deploymentId} not found`);
    }

    const node = this.nodes.find(n => n.id === deployment.nodeId);
    if (!node) {
      throw new Error(`Node ${deployment.nodeId} not found`);
    }

    await fetch(`${node.endpoint}/deployments/${deploymentId}/stop`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.HANZO_NODE_API_KEY}`,
      },
    });

    deployment.status = "stopped";
    deployment.metadata.updatedAt = new Date();
  }

  /**
   * Remove deployment
   */
  async removeDeployment(deploymentId: string): Promise<void> {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment ${deploymentId} not found`);
    }

    const node = this.nodes.find(n => n.id === deployment.nodeId);
    if (!node) {
      throw new Error(`Node ${deployment.nodeId} not found`);
    }

    await fetch(`${node.endpoint}/deployments/${deploymentId}`, {
      method: "DELETE",
      headers: {
        "Authorization": `Bearer ${process.env.HANZO_NODE_API_KEY}`,
      },
    });

    this.deployments.delete(deploymentId);
  }

  /**
   * Get deployment logs
   */
  async getDeploymentLogs(deploymentId: string, tail: number = 100): Promise<string[]> {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment ${deploymentId} not found`);
    }

    const node = this.nodes.find(n => n.id === deployment.nodeId);
    if (!node) {
      throw new Error(`Node ${deployment.nodeId} not found`);
    }

    const response = await fetch(
      `${node.endpoint}/deployments/${deploymentId}/logs?tail=${tail}`,
      {
        headers: {
          "Authorization": `Bearer ${process.env.HANZO_NODE_API_KEY}`,
        },
      }
    );

    const data = await response.json();
    return data.logs;
  }
}

// Export singleton instance
export const blockchainInfra = new HanzoBlockchainInfra();