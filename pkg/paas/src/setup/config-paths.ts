// Paths configuration for Hanzo setup

/**
 * Returns paths for various directories used by Hanzo
 * @param isServer Whether paths are for server (absolute) or client (relative)
 */
export const paths = (isServer = false) => {
  const base = isServer ? "/etc/hanzo" : "./data";
  
  return {
    APPLICATIONS_PATH: `${base}/applications`,
    BACKUPS_PATH: `${base}/backups`,
    SSH_PATH: `${base}/ssh`,
    LOGS_PATH: `${base}/logs`,
    STATIC_PATH: `${base}/static`,
    COMPOSE_PATH: `${base}/compose`,
    DATABASE_PATH: `${base}/database`,
    DOMAINS_PATH: `${base}/domains`,
    MONITORING_PATH: `${base}/monitoring`,
    CONFIG_PATH: `${base}/config`,
  };
};