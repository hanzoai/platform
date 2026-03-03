import _ from "lodash";
import type { ComposeSpecification, DefinitionsService } from "../types";

type DependsOnObject = NonNullable<
	Exclude<DefinitionsService["depends_on"], string[]> extends infer T
		? { [K in keyof T]: T[K] }
		: never
>;

export const addSuffixToServiceNames = (
	services: { [key: string]: DefinitionsService },
	suffix: string,
): { [key: string]: DefinitionsService } => {
	const newServices: { [key: string]: DefinitionsService } = {};

	for (const [serviceName, serviceConfig] of Object.entries(services)) {
		const newServiceName = `${serviceName}-${suffix}`;
		const newServiceConfig = _.cloneDeep(serviceConfig);

		// Replace service names in depends_on
		if (newServiceConfig.depends_on) {
			if (Array.isArray(newServiceConfig.depends_on)) {
				newServiceConfig.depends_on = newServiceConfig.depends_on.map(
					(dep) => `${dep}-${suffix}`,
				);
			} else {
				const newDependsOn: DependsOnObject = {};
				for (const [depName, depConfig] of Object.entries(
					newServiceConfig.depends_on,
				)) {
					newDependsOn[`${depName}-${suffix}`] = depConfig;
				}
				newServiceConfig.depends_on = newDependsOn;
			}
		}

		// Replace name in container_name
		if (newServiceConfig.container_name) {
			newServiceConfig.container_name = `${newServiceConfig.container_name}-${suffix}`;
		}

		// Replace service names in links
		if (newServiceConfig.links) {
			newServiceConfig.links = newServiceConfig.links.map(
				(link) => `${link}-${suffix}`,
			);
		}

		// Replace service names in extends
		if (newServiceConfig.extends) {
			if (typeof newServiceConfig.extends === "string") {
				newServiceConfig.extends = `${newServiceConfig.extends}-${suffix}`;
			} else {
				newServiceConfig.extends.service = `${newServiceConfig.extends.service}-${suffix}`;
			}
		}

		// Replace service names in volumes_from
		if (newServiceConfig.volumes_from) {
			newServiceConfig.volumes_from = newServiceConfig.volumes_from.map(
				(vol) => `${vol}-${suffix}`,
			);
		}

		newServices[newServiceName] = newServiceConfig;
	}

	return newServices;
};

export const addSuffixToAllServiceNames = (
	composeData: ComposeSpecification,
	suffix: string,
): ComposeSpecification => {
	const updatedComposeData = { ...composeData };

	if (updatedComposeData.services) {
		updatedComposeData.services = addSuffixToServiceNames(
			updatedComposeData.services,
			suffix,
		);
	}

	return updatedComposeData;
};