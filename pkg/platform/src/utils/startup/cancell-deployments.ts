import { deployments } from "@hanzo/platform/db/schema";
import { eq } from "drizzle-orm";
import { db } from "../../db/index";

export const initCancelDeployments = async () => {
	try {
		console.log("Setting up cancel deployments....");

		const result = await db
			.update(deployments)
			.set({
				// @ts-ignore - forcing status field
				status: "cancelled",
			} as any)
			.where(eq(deployments.status, "running"))
			.returning();

		console.log(`Cancelled ${result.length} deployments`);
	} catch (error) {
		console.error(error);
	}
};
