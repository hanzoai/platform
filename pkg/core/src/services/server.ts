// This is a simplified server service that only supports local server functionality
// Remote server functionality has been removed

export interface Server {
  serverId: string;
  name: string;
  ipAddress: string;
  port: number;
  username: string;
  sshKeyId: string | null;
  sshKey?: {
    privateKey: string;
  };
  enableDockerCleanup: boolean;
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
 * Simplified implementation that returns a local server instance
 * Remote servers are no longer supported
 */
export const findServerById = async (serverId: string): Promise<Server> => {
  if (serverId !== "local") {
    throw new Error("Multi-server functionality has been removed. Please use the local server only.");
  }

  return localServer;
};

/**
 * Returns all servers - in this simplified implementation, just the local server
 */
export const getAllServers = async (): Promise<Server[]> => {
  return [localServer];
};
