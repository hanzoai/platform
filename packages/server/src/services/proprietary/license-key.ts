import { db } from "@dokploy/server/db";
import { organization, user } from "@dokploy/server/db/schema";
import { eq } from "drizzle-orm";

export const hasValidLicense = async (organizationId: string) => {
	const ownerId = await getOrganizationOwnerId(organizationId);

	if (!ownerId) {
		return false;
	}

	const currentUser = await db.query.user.findFirst({
		where: eq(user.id, ownerId),
		columns: {
			enableEnterpriseFeatures: true,
			isValidEnterpriseLicense: true,
		},
	});
	return !!(
		currentUser?.enableEnterpriseFeatures &&
		currentUser?.isValidEnterpriseLicense
	);
};
