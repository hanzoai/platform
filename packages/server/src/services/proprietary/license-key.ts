import { db } from "@dokploy/server/db";
import { organization, user } from "@dokploy/server/db/schema";
import { eq } from "drizzle-orm";

export const hasValidLicense = async (organizationId: string) => {
	// we need to find the owner of the organization
	const organizationResult = await db.query.organization.findFirst({
		where: eq(organization.id, organizationId),
		columns: { ownerId: true },
	});

	if (!organizationResult) {
		return false;
	}

	const ownerId = organizationResult?.ownerId;

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
