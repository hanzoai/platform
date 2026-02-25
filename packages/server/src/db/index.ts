import { and, eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { dbUrl } from "./constants";
import * as schema from "./schema";

export { and, eq };
export * from "./schema";

type Database = PostgresJsDatabase<typeof schema>;

declare global {
	var db: Database | undefined;
}

export let db: Database;
if (process.env.NODE_ENV === "production") {
	db = drizzle(postgres(dbUrl), {
		schema,
	});
} else {
	if (!global.db)
		global.db = drizzle(postgres(dbUrl), {
			schema,
		});

	db = global.db;
}

export { dbUrl };
