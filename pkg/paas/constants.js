import Docker from "dockerode";
export const docker = new Docker({
    socketPath: process.env.DOCKER_HOST || "/var/run/docker.sock"
});
export const IS_CLOUD = process.env.IS_CLOUD === 'true';
export const APPLICATIONS_PATH = process.env.APPLICATIONS_PATH || '/var/lib/hanzo/applications';
export const DATABASES_PATH = process.env.DATABASES_PATH || '/var/lib/hanzo/databases';
export const COMPOSE_PATH = process.env.COMPOSE_PATH || '/var/lib/hanzo/compose';
export const MONITORING_PATH = process.env.MONITORING_PATH || '/var/lib/hanzo/monitoring';
export const LOGS_PATH = process.env.LOGS_PATH || '/var/lib/hanzo/logs';
export const BACKUPS_PATH = process.env.BACKUPS_PATH || '/var/lib/hanzo/backups';
export const VOLUMES_PATH = process.env.VOLUMES_PATH || '/var/lib/hanzo/volumes';
export const CERTS_PATH = process.env.CERTS_PATH || '/var/lib/hanzo/certs';
export const SWARM_MODE = process.env.SWARM_MODE === 'true';
