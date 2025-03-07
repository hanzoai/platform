import type { ConnectionOptions } from "bullmq";

export const redisConfig: ConnectionOptions = process.env.REDIS_URL
  ? { url: process.env.REDIS_URL }
  : { host: process.env.REDIS_HOST || (process.env.NODE_ENV === "production" ? "hanzo-redis" : "127.0.0.1") };
