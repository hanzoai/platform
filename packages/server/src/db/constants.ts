import fs from "node:fs";

export const {
	DATABASE_URL,
	POSTGRES_PASSWORD_FILE,
	POSTGRES_USER = "hanzo",
	POSTGRES_DB = "hanzo",
	POSTGRES_HOST = "hanzo-postgres",
	POSTGRES_PORT = "5432",
} = process.env;

function readSecret(path: string): string {
	try {
		return fs.readFileSync(path, "utf8").trim();
	} catch {
		throw new Error(`Cannot read secret at ${path}`);
	}
}
export let dbUrl: string;
if (DATABASE_URL) {
	// Compatibilidad legacy / overrides
	dbUrl = DATABASE_URL;
} else if (POSTGRES_PASSWORD_FILE) {
	const password = readSecret(POSTGRES_PASSWORD_FILE);
	dbUrl = `postgres://${POSTGRES_USER}:${encodeURIComponent(
		password,
	)}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}`;
} else {
	if (process.env.NODE_ENV !== "test") {
		console.warn(`
		⚠️  [DEPRECATED DATABASE CONFIG]
		You are using the legacy hardcoded database credentials.
		This mode WILL BE REMOVED in a future release.
		
		Please migrate to Docker Secrets using POSTGRES_PASSWORD_FILE.
		Please execute this command in your server: curl -sSL https://hanzo.com/security/0.26.6.sh | bash
		`);
	}

	if (process.env.NODE_ENV === "production") {
		dbUrl =
			"postgres://hanzo:amukds4wi9001583845717ad2@hanzo-postgres:5432/hanzo";
	} else {
		dbUrl =
			"postgres://hanzo:amukds4wi9001583845717ad2@localhost:5432/hanzo";
	}
}
