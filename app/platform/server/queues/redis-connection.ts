import type { ConnectionOptions } from "@hanzo/mq";

export const redisConfig: ConnectionOptions = {
	host:
		process.env.NODE_ENV === "production"
			? process.env.REDIS_HOST || "hanzo-redis"
			: "127.0.0.1",
	port: parseInt(process.env.REDIS_PORT || "6379", 10),
	password: process.env.REDIS_PASSWORD || undefined,
	db: parseInt(process.env.REDIS_DB || "0", 10),
};
