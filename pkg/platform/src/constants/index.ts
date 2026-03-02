import path from "node:path";
import { createRequire } from "module";
const require = createRequire(import.meta.url);

export const IS_CLOUD = process.env.IS_CLOUD === "true" || !!process.env.KUBERNETES_SERVICE_HOST;
export const DOCKER_ENABLED = process.env.DOCKER_ENABLED !== "false" && !IS_CLOUD;
export const CLEANUP_CRON_JOB = "50 23 * * *";

// Lazy-loaded Docker instance - only connects when actually needed
let _docker: any = null;

export const getDocker = () => {
	if (!DOCKER_ENABLED) {
		throw new Error("Docker is not enabled in this environment. Set DOCKER_ENABLED=true or run locally.");
	}
	if (!_docker) {
		const Docker = require("dockerode");
		_docker = new Docker();
	}
	return _docker;
};

// Legacy export for backwards compatibility - throws if Docker not available
export const docker = new Proxy({} as any, {
	get: (_target, prop) => {
		const d = getDocker();
		const val = d[prop];
		return typeof val === "function" ? val.bind(d) : val;
	},
});

// When not set, use the legacy default so 2FA remains working for users who
// enabled it before BETTER_AUTH_SECRET was introduced .
export const BETTER_AUTH_SECRET =
	process.env.BETTER_AUTH_SECRET || "better-auth-secret-123456789";

export const paths = (isServer = false) => {
	const BASE_PATH =
		isServer || process.env.NODE_ENV === "production"
			? "/etc/platform"
			: path.join(process.cwd(), ".docker");
	const MAIN_TRAEFIK_PATH = `${BASE_PATH}/traefik`;
	const DYNAMIC_TRAEFIK_PATH = `${MAIN_TRAEFIK_PATH}/dynamic`;

	return {
		BASE_PATH,
		MAIN_TRAEFIK_PATH,
		DYNAMIC_TRAEFIK_PATH,
		LOGS_PATH: `${BASE_PATH}/logs`,
		APPLICATIONS_PATH: `${BASE_PATH}/applications`,
		COMPOSE_PATH: `${BASE_PATH}/compose`,
		SSH_PATH: `${BASE_PATH}/ssh`,
		CERTIFICATES_PATH: `${DYNAMIC_TRAEFIK_PATH}/certificates`,
		MONITORING_PATH: `${BASE_PATH}/monitoring`,
		REGISTRY_PATH: `${BASE_PATH}/registry`,
		SCHEDULES_PATH: `${BASE_PATH}/schedules`,
		VOLUME_BACKUPS_PATH: `${BASE_PATH}/volume-backups`,
		VOLUME_BACKUP_LOCK_PATH: `${BASE_PATH}/volume-backup-lock`,
		PATCH_REPOS_PATH: `${BASE_PATH}/patch-repos`,
	};
};
