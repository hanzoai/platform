import bcrypt from "bcrypt";
import { db } from "@hanzo/platform/db";
import { user, account, organization, member } from "@hanzo/platform/db/schema";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

const DEV_ADMIN_EMAIL = "z@hanzo.ai";
const DEV_ADMIN_PASSWORD = "HanzoAdmin2025!";
const DEV_ADMIN_NAME = "Hanzo Admin";

(async () => {
	try {
		console.log("Seeding dev admin user...");

		// Check if user already exists
		const existingUser = await db.query.user.findFirst({
			where: eq(user.email, DEV_ADMIN_EMAIL),
		});

		const hashedPassword = bcrypt.hashSync(DEV_ADMIN_PASSWORD, 10);

		if (existingUser) {
			console.log("User already exists, updating password...");

			// Update password in account table
			await db
				.update(account)
				.set({ password: hashedPassword })
				.where(eq(account.userId, existingUser.id));

			// Ensure email is verified
			await db
				.update(user)
				.set({ emailVerified: true })
				.where(eq(user.id, existingUser.id));

			console.log("Password updated successfully!");
			console.log(`Email: ${DEV_ADMIN_EMAIL}`);
			console.log(`Password: ${DEV_ADMIN_PASSWORD}`);
		} else {
			console.log("Creating new admin user...");

			// Create user
			const userId = nanoid();
			const newUser = await db
				.insert(user)
				.values({
					id: userId,
					name: DEV_ADMIN_NAME,
					email: DEV_ADMIN_EMAIL,
					emailVerified: true,
					createdAt: new Date(),
					updatedAt: new Date(),
				})
				.returning()
				.then((res) => res[0]);

			if (!newUser) {
				throw new Error("Failed to create user");
			}

			// Create account with password
			await db.insert(account).values({
				id: nanoid(),
				userId: newUser.id,
				accountId: newUser.id,
				providerId: "credential",
				password: hashedPassword,
				createdAt: new Date(),
				updatedAt: new Date(),
			});

			// Create organization
			const newOrg = await db
				.insert(organization)
				.values({
					id: nanoid(),
					name: "Hanzo Dev",
					ownerId: newUser.id,
					createdAt: new Date(),
				})
				.returning()
				.then((res) => res[0]);

			if (!newOrg) {
				throw new Error("Failed to create organization");
			}

			// Create member (owner role)
			await db.insert(member).values({
				id: nanoid(),
				userId: newUser.id,
				organizationId: newOrg.id,
				role: "owner",
				createdAt: new Date(),
				isDefault: true,
			});

			console.log("Admin user created successfully!");
			console.log(`Email: ${DEV_ADMIN_EMAIL}`);
			console.log(`Password: ${DEV_ADMIN_PASSWORD}`);
		}

		process.exit(0);
	} catch (error) {
		console.error("Error seeding dev admin:", error);
		process.exit(1);
	}
})();
