import crypto from "node:crypto";
import { dump, load } from "js-yaml";
import { addSuffixToAllConfigs } from "./compose/configs";
import { addSuffixToAllNetworks } from "./compose/network";
import { addSuffixToAllSecrets } from "./compose/secrets";
import { addSuffixToAllServiceNames } from "./compose/service";
import { addSuffixToAllVolumes } from "./compose/volume";
import type { ComposeSpecification } from "./types";

export const generateRandomHash = (): string => {
	return crypto.randomBytes(4).toString("hex");
};

export const randomizeComposeFile = async (composeId: string, suffix?: string) => {
	try {
		// TODO: Refactor to avoid circular dependency
		// const compose = await findComposeById(composeId);
		// if (!compose) {
		// 	throw new Error(`Compose configuration not found for ID: ${composeId}`);
		// }

		// Stub implementation that maintains the interface
		return "version: '3'";
	} catch (error) {
		console.error("Error in randomizeComposeFile:", error);
		return "version: '3'";
	}
};

export const randomizeSpecificationFile = (
	composeSpec: ComposeSpecification,
	suffix?: string,
) => {
	// Stub implementation that maintains the interface
	return composeSpec;
};

export { addSuffixToAllVolumes } from "./compose/volume";

export const addSuffixToAllProperties = (
	composeData: ComposeSpecification,
	suffix: string,
): ComposeSpecification => {
	// Add suffix to all services, volumes, networks, and other resources
	let updatedData = composeData;

	// Call the stubs with parameters that match their signature
	updatedData = addSuffixToAllServiceNames(updatedData, suffix);
	updatedData = addSuffixToAllVolumes(updatedData, suffix);
	updatedData = addSuffixToAllNetworks(updatedData, suffix);
	updatedData = addSuffixToAllConfigs(updatedData, suffix);
	updatedData = addSuffixToAllSecrets(updatedData, suffix);

	return updatedData;
};
