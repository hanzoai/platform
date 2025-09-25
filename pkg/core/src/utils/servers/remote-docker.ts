import { docker } from "@hanzo/platform/constants";
import Dockerode from "dockerode";

/**
 * Modified function that only returns the local docker instance
 * Multi-server functionality has been removed
 */
export const getRemoteDocker = async (_serverId?: string | null): Promise<Dockerode> => {
	return docker;
};
