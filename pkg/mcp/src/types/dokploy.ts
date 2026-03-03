// Basic types for Hanzo API responses
// These are minimal interfaces to avoid 'any' usage while maintaining flexibility

export interface HanzoProject {
  projectId: string;
  name: string;
  description?: string | null;
  createdAt: string;
  organizationId: string;
  applications?: HanzoApplication[];
  postgres?: HanzoPostgres[];
  mysql?: unknown[];
  mariadb?: unknown[];
  mongo?: unknown[];
  redis?: unknown[];
  compose?: HanzoCompose[];
  [key: string]: unknown; // Allow additional properties
}

export interface HanzoApplication {
  applicationId: string;
  name: string;
  appName: string;
  applicationStatus: string;
  sourceType: string;
  buildType: string;
  domains?: { length?: number }[];
  [key: string]: unknown; // Allow additional properties
}

export interface HanzoPostgres {
  postgresId: string;
  name: string;
  appName: string;
  applicationStatus: string;
  databaseName: string;
  [key: string]: unknown; // Allow additional properties
}

export interface HanzoCompose {
  composeId: string;
  name: string;
  appName: string;
  composeStatus: string;
  sourceType: string;
  domains?: { length?: number }[];
  [key: string]: unknown; // Allow additional properties
}

// Utility type for external API responses where we can't guarantee full typing
export type ExternalApiResponse<T = Record<string, unknown>> = T & {
  [key: string]: unknown;
};

// Type for completely unknown API responses
export type UnknownApiData = Record<string, unknown>;
