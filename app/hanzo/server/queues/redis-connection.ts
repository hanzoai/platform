import type { ConnectionOptions } from "bullmq";

function parseRedisUrl(url: string): { host: string; port: number } {
	try {
		const parsed = new URL(url);
		return {
			host: parsed.hostname,
			port: parsed.port ? Number.parseInt(parsed.port) : 6379,
		};
	} catch {
		return { host: "127.0.0.1", port: 6379 };
	}
}

export const redisConfig: ConnectionOptions = process.env.REDIS_URL
	? parseRedisUrl(process.env.REDIS_URL)
	: {
			host: process.env.REDIS_HOST || "127.0.0.1",
			port: process.env.REDIS_PORT ? Number.parseInt(process.env.REDIS_PORT) : 6379,
		};
