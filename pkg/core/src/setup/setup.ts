// Placeholder for setup functionality
export const setupInfrastructure = async () => {
  // Stub implementation
  console.log("Infrastructure setup would be performed here");
};

// Add exports for compatibility
export const setupLocalMode = async () => {
  // Stub implementation
  console.log("Local mode setup would be performed here");
};

// Export some values to avoid errors in other modules
export const TRAEFIK_PORT = 80;
export const TRAEFIK_SSL_PORT = 443;
export const TRAEFIK_VERSION = "v2.10";

// Export functions to avoid errors in other modules
export const getDefaultMiddlewares = () => [];
export const getDefaultServerTraefikConfig = () => ({});
export const getRemoteDocker = async (serverId?: string) => {
  return {
    exec: async (command: string, args: string[] = []) => ({ stdout: "", stderr: "" }),
    swarmInspect: async () => ({ JoinTokens: { Worker: "worker-token", Manager: "manager-token" } }),
    version: async () => ({ Version: "24.0.5" }),
    listNodes: async () => [],
    getContainer: (id: string) => ({
      inspect: async () => ({}),
      start: async () => ({}),
      stop: async () => ({}),
      remove: async () => ({})
    }),
    createContainer: async (options: any) => ({ id: "container-id", start: async () => ({}) }),
    listContainers: async (options?: any) => ([]),
    pull: async (image: string) => ({})
  };
};

// Export Docker utilities
export const dockerUtils = {
  swarmInspect: async () => ({ JoinTokens: { Worker: "worker-token", Manager: "manager-token" } }),
  version: async () => ({ Version: "24.0.5" }),
  listNodes: async () => []
};