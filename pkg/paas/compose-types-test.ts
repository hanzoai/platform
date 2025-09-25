// This file tests just the Compose spec types

// Here are the Compose specification types
interface ComposeSpecification {
  version?: string;
  name?: string;
  services?: { [key: string]: ServiceConfig };
  networks?: { [key: string]: NetworkConfig };
  volumes?: { [key: string]: VolumeConfig };
  secrets?: { [key: string]: SecretConfig | string };
  configs?: { [key: string]: ConfigObjConfig | string };
}

interface ServiceConfig {
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

interface BuildConfig {
  context?: string;
  dockerfile?: string;
  args?: { [key: string]: string } | string[];
  cache_from?: string[];
  labels?: { [key: string]: string } | string[];
  target?: string;
  [key: string]: any; // Allow other properties
}

interface ServiceDependencyConfig {
  condition?: "service_started" | "service_healthy" | "service_completed_successfully";
}

interface DeployConfig {
  mode?: "replicated" | "global";
  replicas?: number;
  resources?: ResourcesConfig;
  restart_policy?: RestartPolicyConfig;
  placement?: PlacementConfig;
  [key: string]: any; // Allow other properties
}

interface ResourcesConfig {
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

interface RestartPolicyConfig {
  condition?: "none" | "on-failure" | "any";
  delay?: string;
  max_attempts?: number;
  window?: string;
}

interface PlacementConfig {
  constraints?: string[];
  preferences?: { spread: string }[];
}

interface NetworkAttachConfig {
  aliases?: string[];
  ipv4_address?: string;
  ipv6_address?: string;
}

interface PortConfig {
  target?: number;
  published?: number | string;
  protocol?: string;
  mode?: "host" | "ingress";
}

interface VolumeMount {
  type?: "volume" | "bind" | "tmpfs" | "npipe";
  source?: string;
  target?: string;
  read_only?: boolean;
  bind?: { propagation?: string };
  volume?: { nocopy?: boolean };
  tmpfs?: { size?: number | string };
}

interface NetworkConfig {
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

interface VolumeConfig {
  driver?: string;
  driver_opts?: { [key: string]: string };
  external?: boolean | { name?: string };
  labels?: { [key: string]: string } | string[];
  name?: string;
}

interface SecretConfig {
  file?: string;
  environment?: string;
  external?: boolean | { name?: string };
  name?: string;
  driver?: string;
  driver_opts?: { [key: string]: string };
  labels?: { [key: string]: string };
}

interface ConfigObjConfig {
  file?: string;
  environment?: string;
  external?: boolean | { name?: string };
  name?: string;
  labels?: { [key: string]: string } | string[];
}

// Create a basic Compose specification
const testComposeSpec: ComposeSpecification = {
  version: '3',
  services: {
    web: {
      image: 'nginx:latest',
      ports: ['80:80'],
      volumes: ['./html:/usr/share/nginx/html']
    },
    db: {
      image: 'postgres:14',
      volumes: ['postgres_data:/var/lib/postgresql/data'],
      environment: {
        POSTGRES_PASSWORD: 'password',
        POSTGRES_USER: 'user',
        POSTGRES_DB: 'db'
      }
    }
  },
  volumes: {
    postgres_data: {}
  }
};

// Log the spec to confirm it's valid
console.log('Successfully created Compose specification:');
console.log(JSON.stringify(testComposeSpec, null, 2));

// Validate that the specification matches the types
const validateCompose = (spec: ComposeSpecification): boolean => {
  return (
    !!spec.version &&
    !!spec.services &&
    Object.keys(spec.services).length > 0
  );
};

console.log('Validation result:', validateCompose(testComposeSpec));