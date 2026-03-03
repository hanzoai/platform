import path from "node:path";

export const IS_CLOUD = process.env.IS_CLOUD === "true";
export const DOCKER_ENABLED = process.env.DOCKER_ENABLED !== "false" && !IS_CLOUD;

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
	get(_, prop) {
		return getDocker()[prop];
	}
});

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
	};
};
