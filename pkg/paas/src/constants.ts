export const IS_CLOUD = process.env.IS_CLOUD === 'true';
export const APPLICATIONS_PATH = '/var/lib/hanzo/applications';
export const DATABASES_PATH = '/var/lib/hanzo/databases';
export const COMPOSE_PATH = process.env.COMPOSE_PATH || '/var/lib/hanzo/compose';
export const MONITORING_PATH = '/var/lib/hanzo/monitoring';
export const LOGS_PATH = '/var/lib/hanzo/logs';
export const BACKUPS_PATH = '/var/lib/hanzo/backups';
export const VOLUMES_PATH = '/var/lib/hanzo/volumes';
export const CERTS_PATH = '/var/lib/hanzo/certs';
