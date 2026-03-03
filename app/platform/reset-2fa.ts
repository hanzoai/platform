import { findOwner } from "@hanzo/platform";
import { db } from "@hanzo/platform/db";
import { user } from "@hanzo/platform/db/schema";
import { eq } from "drizzle-orm";

(async () => {
	try {
		const result = await findOwner();

		const update = await db
			.update(user)
			.set({
				twoFactorEnabled: false,
			})
			.where(eq(user.id, result.userId));

		if (update) {
			console.log("2FA reset successful");
		} else {
			console.log("Password reset failed");
		}

		process.exit(0);
	} catch (error) {
		console.log("Error resetting 2FA", error);
	}
})();
