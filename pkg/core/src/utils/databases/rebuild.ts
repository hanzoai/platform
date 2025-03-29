import { deployPostgres } from "@hanzo/core/services/postgres";
import { execAsyncRemote } from "../process/execAsync";
import { execAsync } from "../process/execAsync";
import { deployMySql } from "@hanzo/core/services/mysql";
import { deployMariadb } from "@hanzo/core/services/mariadb";
import { deployMongo } from "@hanzo/core/services/mongo";
import { deployRedis } from "@hanzo/core/services/redis";
import { removeService } from "../docker/utils";
import { db } from "@hanzo/core/db";
import {
	applications,
	postgres,
	mysql,
	mongo,
	mariadb,
	redis,
} from "@hanzo/core/db/schema";
import { eq } from "drizzle-orm";

/**
 * Function to rebuild database services
 */
export const rebuildDatabase = async (id: string, type: 'postgres' | 'mongo' | 'mysql' | 'mariadb' | 'redis') => {
	try {
		let appName = '';
		let serverId: string | null = null;

		switch (type) {
			case 'postgres':
				const pg = await db.query.postgres.findFirst({
					where: eq(postgres.postgresId, id)
				});
				if (!pg) throw new Error('Postgres database not found');
				appName = pg.appName;
				serverId = pg.serverId;
				await removeService(appName, serverId);
				await deployPostgres(id);
				break;

			case 'mongo':
				const mongodb = await db.query.mongo.findFirst({
					where: eq(mongo.mongoId, id)
				});
				if (!mongodb) throw new Error('MongoDB database not found');
				appName = mongodb.appName;
				serverId = mongodb.serverId;
				await removeService(appName, serverId);
				await deployMongo(id);
				break;

			case 'mysql':
				const mysqldb = await db.query.mysql.findFirst({
					where: eq(mysql.mysqlId, id)
				});
				if (!mysqldb) throw new Error('MySQL database not found');
				appName = mysqldb.appName;
				serverId = mysqldb.serverId;
				await removeService(appName, serverId);
				await deployMySql(id);
				break;

			case 'mariadb':
				const mariadbInstance = await db.query.mariadb.findFirst({
					where: eq(mariadb.mariadbId, id)
				});
				if (!mariadbInstance) throw new Error('MariaDB database not found');
				appName = mariadbInstance.appName;
				serverId = mariadbInstance.serverId;
				await removeService(appName, serverId);
				await deployMariadb(id);
				break;

			case 'redis':
				const redisInstance = await db.query.redis.findFirst({
					where: eq(redis.redisId, id)
				});
				if (!redisInstance) throw new Error('Redis database not found');
				appName = redisInstance.appName;
				serverId = redisInstance.serverId;
				await removeService(appName, serverId);
				await deployRedis(id);
				break;

			default:
				throw new Error('Invalid database type');
		}

		return { success: true };
	} catch (error) {
		console.error('Error rebuilding database:', error);
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Unknown error occurred'
		};
	}
};
