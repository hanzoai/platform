// ComposeSpec types based on https://github.com/compose-spec/compose-spec/blob/main/spec.md
export interface ComposeSpecification {
  version?: string;
  name?: string;
  services?: { [key: string]: ServiceConfig };
  networks?: { [key: string]: NetworkConfig };
  volumes?: { [key: string]: VolumeConfig };
  secrets?: { [key: string]: SecretConfig | string };
  configs?: { [key: string]: ConfigObjConfig | string };
}

export interface ServiceConfig {
  image?: string;
  build?: string | BuildConfig;
  command?: string | string[];
  container_name?: string;
  depends_on?: string[] | { [key: string]: ServiceDependencyConfig };
  deploy?: DeployConfig;
  environment?: { [key: string]: string } | string[];
  env_file?: string | string[];
  expose?: (string | number)[];
  networks?: { [key: string]: NetworkAttachConfig } | string[];
  ports?: (string | PortConfig)[];
  restart?: string;
  volumes?: (string | VolumeMount)[];
  [key: string]: any; // Allow other properties
}

export interface BuildConfig {
  context?: string;
  dockerfile?: string;
  args?: { [key: string]: string } | string[];
  cache_from?: string[];
  labels?: { [key: string]: string } | string[];
  target?: string;
  [key: string]: any; // Allow other properties
}

export interface ServiceDependencyConfig {
  condition?: "service_started" | "service_healthy" | "service_completed_successfully";
}

export interface DeployConfig {
  mode?: "replicated" | "global";
  replicas?: number;
  resources?: ResourcesConfig;
  restart_policy?: RestartPolicyConfig;
  placement?: PlacementConfig;
  [key: string]: any; // Allow other properties
}

export interface ResourcesConfig {
  limits?: {
    cpus?: string;
    memory?: string;
    pids?: number;
  };
  reservations?: {
    cpus?: string;
    memory?: string;
    pids?: number;
  };
}

export interface RestartPolicyConfig {
  condition?: "none" | "on-failure" | "any";
  delay?: string;
  max_attempts?: number;
  window?: string;
}

export interface PlacementConfig {
  constraints?: string[];
  preferences?: { spread: string }[];
}

export interface NetworkAttachConfig {
  aliases?: string[];
  ipv4_address?: string;
  ipv6_address?: string;
}

export interface PortConfig {
  target?: number;
  published?: number | string;
  protocol?: string;
  mode?: "host" | "ingress";
}

export interface VolumeMount {
  type?: "volume" | "bind" | "tmpfs" | "npipe";
  source?: string;
  target?: string;
  read_only?: boolean;
  bind?: { propagation?: string };
  volume?: { nocopy?: boolean };
  tmpfs?: { size?: number | string };
}

export interface NetworkConfig {
  driver?: string;
  driver_opts?: { [key: string]: string };
  attachable?: boolean;
  enable_ipv6?: boolean;
  ipam?: {
    driver?: string;
    config?: { subnet?: string; ip_range?: string; gateway?: string }[];
  };
  internal?: boolean;
  labels?: { [key: string]: string } | string[];
  name?: string;
}

export interface VolumeConfig {
  driver?: string;
  driver_opts?: { [key: string]: string };
  external?: boolean | { name?: string };
  labels?: { [key: string]: string } | string[];
  name?: string;
}

export interface SecretConfig {
  file?: string;
  environment?: string;
  external?: boolean | { name?: string };
  name?: string;
  driver?: string;
  driver_opts?: { [key: string]: string };
  labels?: { [key: string]: string };
}

export interface ConfigObjConfig {
  file?: string;
  environment?: string;
  external?: boolean | { name?: string };
  name?: string;
  labels?: { [key: string]: string } | string[];
}

// Type for Compose entries in the database
export interface Compose {
  id: string;
  name: string;
  appName: string | null;
  createdAt: string;
  description: string | null;
  specification: ComposeSpecification;
  serverId: string;
  lastDeployedAt: string | null;
  status: "idle" | "deploying" | "deployed" | "error";
  errorMessage: string | null;

  // Fields for Compose file management
  composeFile?: string;
  composePath?: string;
  composeType?: string;

  // Source type fields
  sourceType?: "git" | "custom" | "template" | "raw";

  // For git providers
  repository?: string;
  owner?: string;
  branch?: string;
  githubId?: string;

  // For GitLab provider
  gitlabId?: string;
  gitlabPathNamespace?: string;
  gitlabBranch?: string;

  // For Bitbucket provider
  bitbucketRepository?: string;
  bitbucketOwner?: string;
  bitbucketBranch?: string;
  bitbucketId?: string;

  // For custom git setup
  customGitUrl?: string;
  customGitBranch?: string;
  customGitSSHKeyId?: string;

  // Deployment configuration
  isolatedDeployment?: boolean;
  randomize?: boolean;
  suffix?: string;
}

// Mock implementation for development
let mockComposes: Compose[] = [];

/**
 * Find a compose configuration by ID
 */
export const findComposeById = async (id: string): Promise<Compose | null> => {
  // In a real implementation, this would query the database
  return mockComposes.find(compose => compose.id === id) || null;
};

/**
 * Create a new compose configuration
 */
export const createCompose = async (
  name: string,
  specification: ComposeSpecification,
  serverId: string,
  appName?: string,
  description?: string
): Promise<Compose> => {
  // In a real implementation, this would insert into the database
  const id = `compose_${Date.now()}`;
  const now = new Date().toISOString();

  const newCompose: Compose = {
    id,
    name,
    appName: appName || null,
    createdAt: now,
    description: description || null,
    specification,
    serverId,
    lastDeployedAt: null,
    status: "idle",
    errorMessage: null,
  };

  mockComposes.push(newCompose);

  return newCompose;
};

/**
 * Update an existing compose configuration
 */

export const updateCompose = async (
  id: string,
  data: Partial<Omit<Compose, "id" | "createdAt">>
): Promise<Compose | null> => {
  // In a real implementation, this would update the database
  const index = mockComposes.findIndex(compose => compose.id === id);
  if (index === -1) return null;

  const existingCompose = mockComposes[index];

  if (!existingCompose) return null;

  // Ensure all required fields are preserved
  mockComposes[index] = {
    ...existingCompose,
    ...data,
    id: existingCompose.id, // Keep the existing ID
    createdAt: existingCompose.createdAt, // Keep the existing createdAt
    name: data.name ?? existingCompose.name, // Ensure name is not undefined
    specification: data.specification ?? existingCompose.specification, // Ensure specification is not undefined
    serverId: data.serverId ?? existingCompose.serverId // Ensure serverId is not undefined
  };

  if (mockComposes && index >= 0 && index < mockComposes.length) {
    return mockComposes[index];
  }
  return null;
};

/**
 * Delete a compose configuration
 */
export const deleteCompose = async (id: string): Promise<boolean> => {
  // In a real implementation, this would delete from the database
  const initialLength = mockComposes.length;
  mockComposes = mockComposes.filter(compose => compose.id !== id);
  return mockComposes.length < initialLength;
};

/**
 * List all compose configurations, optionally filtered by server
 */
export const listComposes = async (serverId?: string): Promise<Compose[]> => {
  // In a real implementation, this would query the database
  if (serverId) {
    return mockComposes.filter(compose => compose.serverId === serverId);
  }

  return mockComposes;
};

/**
 * Deploy a compose specification to a server
 */
export const deployCompose = async (
  composeId: string,
  options?: {
    forceRecreate?: boolean;
    noRecreate?: boolean;
    removeOrphans?: boolean;
  }
): Promise<Compose | null> => {
  // In a real implementation, this would deploy to a server
  const composeData = await findComposeById(composeId);
  if (!composeData) return null;

  // Update status to deploying
  await updateCompose(composeId, { status: "deploying" });

  try {
    // Simulate deployment
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Update status to deployed
    await updateCompose(composeId, {
      status: "deployed",
      lastDeployedAt: new Date().toISOString()
    });

    return findComposeById(composeId);
  } catch (error) {
    // Update status to error
    await updateCompose(composeId, {
      status: "error",
      errorMessage: error instanceof Error ? error.message : String(error)
    });
    return findComposeById(composeId);
  }
};

/**
 * Stop a deployed compose application
 */
export const stopCompose = async (
  composeId: string,
  options?: {
    timeout?: number;
    removeVolumes?: boolean;
    removeImages?: "all" | "local";
  }
): Promise<Compose | null> => {
  // In a real implementation, this would stop containers on a server
  const composeData = await findComposeById(composeId);
  if (!composeData) return null;

  try {
    // Simulate stopping
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Update status to idle
    await updateCompose(composeId, { status: "idle" });

    return findComposeById(composeId);
  } catch (error) {
    // Update status to error
    await updateCompose(composeId, {
      status: "error",
      errorMessage: error instanceof Error ? error.message : String(error)
    });
    return findComposeById(composeId);
  }
};

// Add deployRemoteCompose function
export const deployRemoteCompose = async ({
  composeId,
  titleLog = "Manual deployment",
  descriptionLog = "",
}: {
  composeId: string;
  titleLog: string;
  descriptionLog: string;
}) => {
  // Stub implementation
  console.log(`Deploying remote compose: ${composeId} - ${titleLog}`);
  return {
    success: true,
    deploymentId: `deployment-${Date.now()}`,
  };
};

// Add rebuildCompose function
export const rebuildCompose = async (composeId: string) => {
  console.log(`Rebuilding compose: ${composeId}`);
  return {
    success: true,
    composeId,
  };
};

// Add rebuildRemoteCompose function
export const rebuildRemoteCompose = async (composeId: string) => {
  console.log(`Rebuilding remote compose: ${composeId}`);
  return {
    success: true,
    composeId,
  };
};
