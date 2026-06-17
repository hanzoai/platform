import { db } from "@hanzo/platform/db";
import {
	libsql,
	mariadb,
	mongo,
	mysql,
	postgres,
	redis,
} from "@hanzo/platform/db/schema";
import { deployLibsql } from "@hanzo/platform/services/libsql";
import { deployMariadb } from "@hanzo/platform/services/mariadb";
import { deployMongo } from "@hanzo/platform/services/mongo";
import { deployMySql } from "@hanzo/platform/services/mysql";
import { deployPostgres } from "@hanzo/platform/services/postgres";
import { deployRedis } from "@hanzo/platform/services/redis";
import { eq } from "drizzle-orm";
import { removeService } from "../docker/utils";
import { execAsync, execAsyncRemote } from "../process/execAsync";

type DatabaseType =
	| "postgres"
	| "mysql"
	| "mariadb"
	| "mongo"
	| "redis"
	| "libsql";

export const rebuildDatabase = async (
	databaseId: string,
	type: DatabaseType,
) => {
	const database = await findDatabaseById(databaseId, type);

	if (!database) {
		throw new Error("Database not found");
	}

	await removeService(database.appName, database.serverId);
	await new Promise((resolve) => setTimeout(resolve, 6000));

	for (const mount of database.mounts) {
		if (mount.type === "volume") {
			const command = `docker volume rm ${mount?.volumeName} --force`;
			if (database.serverId) {
				await execAsyncRemote(database.serverId, command);
			} else {
				await execAsync(command);
			}
		}
	}

	if (type === "postgres") {
		await deployPostgres(databaseId);
	} else if (type === "mysql") {
		await deployMySql(databaseId);
	} else if (type === "mariadb") {
		await deployMariadb(databaseId);
	} else if (type === "mongo") {
		await deployMongo(databaseId);
	} else if (type === "redis") {
		await deployRedis(databaseId);
	} else if (type === "libsql") {
		await deployLibsql(databaseId);
	}
};

const findDatabaseById = async (databaseId: string, type: DatabaseType) => {
	if (type === "postgres") {
		return await db.query.postgres.findFirst({
			where: eq(postgres.postgresId, databaseId),
			with: {
				mounts: true,
			},
		});
	}
	if (type === "mysql") {
		return await db.query.mysql.findFirst({
			where: eq(mysql.mysqlId, databaseId),
			with: {
				mounts: true,
			},
		});
	}
	if (type === "mariadb") {
		return await db.query.mariadb.findFirst({
			where: eq(mariadb.mariadbId, databaseId),
			with: {
				mounts: true,
			},
		});
	}
	if (type === "mongo") {
		return await db.query.mongo.findFirst({
			where: eq(mongo.mongoId, databaseId),
			with: {
				mounts: true,
			},
		});
	}
	if (type === "redis") {
		return await db.query.redis.findFirst({
			where: eq(redis.redisId, databaseId),
			with: {
				mounts: true,
			},
		});
	}
	if (type === "libsql") {
		return await db.query.libsql.findFirst({
			where: eq(libsql.libsqlId, databaseId),
			with: {
				mounts: true,
			},
		});
	}
};
