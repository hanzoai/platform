import { findComposeById } from "../../db/schema/compose";
import { dump, load } from "js-yaml";
import { addAppNameToAllServiceNames } from "./collision/root-network";
import { generateRandomHash, addSuffixToAllVolumes } from "./compose";
import { addSuffixToAllProperties } from "./compose";
import type { ComposeSpecification } from "./types";

export const addAppNameToPreventCollision = (
	composeData: ComposeSpecification,
	appName: string,
): ComposeSpecification => {
	let updatedComposeData = { ...composeData };

	updatedComposeData = addAppNameToAllServiceNames(updatedComposeData, appName);
	updatedComposeData = addSuffixToAllVolumes(updatedComposeData, appName);
	return updatedComposeData;
};

export const randomizeIsolatedDeploymentComposeFile = async (
	composeId: string,
	suffix?: string,
) => {
	const compose = await findComposeById(composeId);
	const composeFile = compose?.composeFile;
	const composeData = load(composeFile || "") as ComposeSpecification;

	const randomSuffix = suffix || compose?.appName || generateRandomHash();

	const newComposeFile = addAppNameToPreventCollision(
		composeData,
		randomSuffix,
	);

	return dump(newComposeFile);
};

export const randomizeDeployableSpecificationFile = (
	composeSpec: ComposeSpecification,
	suffix?: string,
) => {
	if (!suffix) {
		return composeSpec;
	}
	const newComposeFile = addAppNameToPreventCollision(composeSpec, suffix);
	return newComposeFile;
};

export const getModifiedComposeDataFromAppName = (
	composeData: ComposeSpecification,
	appName: string,
): ComposeSpecification => {
	// Create a copy of the compose data
	let updatedComposeData = { ...composeData };

	// Use the utility functions to add suffix to all properties
	updatedComposeData = addSuffixToAllProperties(updatedComposeData, appName);

	return updatedComposeData;
};

export const getModifiedComposeDataFromCompose = async (
	composeId: string,
	suffix?: string,
) => {
	const compose = await findComposeById(composeId);
	if (!compose) {
		throw new Error(`Compose with ID ${composeId} not found`);
	}

	const composeFile = compose.composeFile ?? "";
	if (!composeFile) {
		throw new Error(`Compose file is empty for ID: ${composeId}`);
	}

	const composeData = load(composeFile || "") as ComposeSpecification;
	const randomSuffix = suffix || compose?.appName || generateRandomHash();

	return getModifiedComposeDataFromAppName(composeData, randomSuffix);
};
