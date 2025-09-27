// Environment variables
export * from "./env";

// Authentication
export * from "./lib/auth";

// Services
export * from "./services/application";
export * from "./services/redis";
export * from "./services/mount";
export * from "./services/postgres";
export * from "./services/mysql";
export * from "./services/mongo";
export * from "./services/mariadb";
export * from "./services/backup";
export * from "./services/security";
export * from "./services/notification";
export * from "./services/settings";
export * from "./services/docker";
export * from "./services/certificate";
export * from "./services/cluster";
export * from "./services/destination";
export * from "./services/domain";
export * from "./services/project";
export * from "./services/registry";
export * from "./services/port";
export * from "./services/ssh-key";
export * from "./services/user";
export * from "./services/ai";
export * from "./services/deployment";
export * from "./services/git-provider";
export * from "./services/gitlab";
export * from "./services/github";
export * from "./services/bitbucket";
export * from "./services/admin";
export * from "./services/server";
export * from "./services/environment";
export * from "./services/schedule";

// Export Compose Spec related functionality
export * from "./services/compose";

// Utility functions
export * from "./utils/scheduling/backup";
export { initCronJobs, keepLatestNBackups } from "./utils/backups/index";
export { normalizeS3Path } from "./utils/backups/utils";
// Explicitly import and rename to avoid conflicts
import { rebuildDatabase as rebuildDatabaseUtil } from "./utils/databases/rebuild";
export { rebuildDatabaseUtil as rebuildDatabase };

// Templates
export * from "./templates";
export * from "./templates/processors";

// Process utilities
export { execAsync, execAsyncStream, execAsyncRemote } from "./utils/process/execAsync";

// Setup
export * from "./setup/config-paths";
export * from "./setup/setup";
// Don't export these to avoid conflicts
// export * from "./setup/tls-setup";
// export * from "./setup/traefik-setup";
export * from "./setup/monitoring-setup";
export * from "./setup/docker-compose";
export * from "./setup/docker-swarm";

// Constants
export * from "./constants";
export { paths } from "./constants";

// WebSocket utilities
export * from "./wss/utils";
// Docker stats utilities (stub implementations)
export const getLastAdvancedStatsFile = async () => null;
export const getAdvancedStats = async () => ({ containers: [], memory: 0, cpu: 0, disk: 0 });
export const collectDockerStats = async () => ({ containers: [] });
export const saveAdvancedStats = async (stats: any) => {};
export const recordAdvancedStats = async () => {};
export const cleanupOldStats = async () => {};
export const getStatsHistory = async () => [];
