// This is a server service that supports local and remote server functionality

export type ServerType = "local" | "ssh" | "swarm" | "fly" | "kubernetes";

export interface Server {
  serverId: string;
  name: string;
  type: ServerType;
  ipAddress: string;
  port: number;
  username: string;
  sshKeyId: string | null;
  sshKey?: {
    privateKey: string;
  };
  enableDockerCleanup: boolean;
  flyToken?: string;
  flyRegion?: string;
  flyMachineSize?: string;
  dockerSwarm?: {
    manager: boolean;
    labels?: Record<string, string>;
    role?: "manager" | "worker";
  };
  kubernetes?: {
    kubeconfig?: string;
    namespace?: string;
    context?: string;
  };
  metricsConfig: {
    server: {
      type: "Hanzo";
      refreshRate: number;
      port: number;
      token: string;
      urlCallback: string;
      retentionDays: number;
      cronJob: string;
      thresholds: {
        cpu: number;
        memory: number;
      };
    };
    containers: {
      refreshRate: number;
      services: {
        include: string[];
        exclude: string[];
      };
    };
  };
}

// Local server instance
const localServer: Server = {
  serverId: "local",
  name: "Local Server",
  type: "local",
  ipAddress: "127.0.0.1",
  port: 22,
  username: "root",
  sshKeyId: null,
  enableDockerCleanup: false,
  metricsConfig: {
    server: {
      type: "Hanzo",
      refreshRate: 10000,
      port: 9100,
      token: "",
      urlCallback: "",
      retentionDays: 7,
      cronJob: "0 0 * * *",
      thresholds: {
        cpu: 80,
        memory: 80
      }
    },
    containers: {
      refreshRate: 10000,
      services: {
        include: [],
        exclude: []
      }
    }
  }
};

/**
 * Find a server by its ID
 * For now, this just returns the local server instance
 * In production, this would query the database
 */
export const findServerById = async (serverId: string): Promise<Server> => {
  if (serverId !== "local") {
    // In production, this would query the database
    throw new Error("Remote servers require database lookup. Local dev mode only supports the local server.");
  }

  return localServer;
};

/**
 * Returns all servers
 * For now, this just returns the local server instance
 * In production, this would query the database
 */
export const getAllServers = async (): Promise<Server[]> => {
  // In production, this would query the database
  return [localServer];
};

/**
 * Initialize a Docker Swarm on a server
 * This is a stub implementation that would be replaced with actual functionality
 */
export const initializeSwarm = async (
  serverId: string
): Promise<{ managerToken: string; workerToken: string }> => {
  return {
    managerToken: "stub-manager-token",
    workerToken: "stub-worker-token"
  };
};