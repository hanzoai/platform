import bcrypt from "bcrypt";
import postgres from "postgres";
import { nanoid } from "nanoid";

const DEV_ADMIN_EMAIL = "z@hanzo.ai";
const DEV_ADMIN_PASSWORD = "HanzoAdmin2025!";
const DEV_ADMIN_NAME = "Hanzo Admin";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
	console.error("DATABASE_URL not set");
	process.exit(1);
}

const sql = postgres(DATABASE_URL);

(async () => {
	try {
		console.log("Seeding dev admin user...");
		console.log("Using database:", DATABASE_URL.replace(/:[^:@]+@/, ":****@"));

		const hashedPassword = bcrypt.hashSync(DEV_ADMIN_PASSWORD, 10);

		// Check if user already exists
		const existingUsers = await sql`
			SELECT id, email FROM "user" WHERE email = ${DEV_ADMIN_EMAIL}
		`;

		if (existingUsers.length > 0) {
			const existingUser = existingUsers[0];
			console.log("User already exists, updating password...");

			// Update password in account table
			await sql`
				UPDATE account SET password = ${hashedPassword} WHERE user_id = ${existingUser.id}
			`;

			// Ensure email is verified
			await sql`
				UPDATE "user" SET email_verified = true WHERE id = ${existingUser.id}
			`;

			console.log("Password updated successfully!");
		} else {
			console.log("Creating new admin user...");

			const userId = nanoid();
			const orgId = nanoid();
			const accountId = nanoid();
			const memberId = nanoid();
			const now = new Date();

			// Create user
			await sql`
				INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
				VALUES (${userId}, ${DEV_ADMIN_NAME}, ${DEV_ADMIN_EMAIL}, true, ${now}, ${now})
			`;

			// Create account with password
			await sql`
				INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at)
				VALUES (${accountId}, ${userId}, 'credential', ${userId}, ${hashedPassword}, ${now}, ${now})
			`;

			// Create organization
			await sql`
				INSERT INTO organization (id, name, owner_id, created_at)
				VALUES (${orgId}, 'Hanzo Dev', ${userId}, ${now})
			`;

			// Create member (owner role)
			await sql`
				INSERT INTO member (id, user_id, organization_id, role, created_at, is_default)
				VALUES (${memberId}, ${userId}, ${orgId}, 'owner', ${now}, true)
			`;

			console.log("Admin user created successfully!");
		}

		console.log(`Email: ${DEV_ADMIN_EMAIL}`);
		console.log(`Password: ${DEV_ADMIN_PASSWORD}`);

		await sql.end();
		process.exit(0);
	} catch (error) {
		console.error("Error seeding dev admin:", error);
		await sql.end();
		process.exit(1);
	}
})();
