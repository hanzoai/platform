import { dbUrl } from "@hanzo/platform/db";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
	schema: "./server/db/schema/index.ts",
	dialect: "sqlite",
	dbCredentials: {
		url: dbUrl,
	},
	out: "drizzle",
	migrations: {
		table: "migrations",
	},
});
