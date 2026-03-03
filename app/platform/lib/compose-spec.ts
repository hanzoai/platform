/**
 * Compose Specification v3.0
 *
 * Single source of truth for compose spec types
 * Orthogonal to deployment mechanism
 */

export interface ComposeSpec {
  version: "3.0";
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
  deploy?: DeploySpec;
  depends_on?: string[] | Record<string, DependsOnSpec>;
  healthcheck?: HealthcheckSpec;
  labels?: Record<string, string>;
  restart?: "no" | "always" | "on-failure" | "unless-stopped";
}

export interface DeploySpec {
  replicas?: number;
  resources?: {
    limits?: ResourceSpec;
    reservations?: ResourceSpec;
  };
  placement?: {
    constraints?: string[];
  };
}

export interface ResourceSpec {
  cpus?: string;
  memory?: string;
  gpus?: string;
}

export interface DependsOnSpec {
  condition: "service_started" | "service_healthy" | "service_completed_successfully";
}

export interface HealthcheckSpec {
  test: string | string[];
  interval?: string;
  timeout?: string;
  retries?: number;
  start_period?: string;
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