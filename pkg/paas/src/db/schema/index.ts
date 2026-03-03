// Import tables for type exports
import { domains } from "./domain";
import { users } from "./user";
import { redirects } from "./redirect";
import { security } from "./security";
import { destinations } from "./destination";

export * from "./account";
export * from "./ai";
export * from "./application";
export * from "./backups";
export * from "./bitbucket";
export * from "./certificate";
export * from "./compose";
export * from "./deployment";
export * from "./destination";
export * from "./domain";
export * from "./environment";
export * from "./git-provider";
export * from "./gitea";
export * from "./github";
export * from "./gitlab";
export * from "./mariadb";
export * from "./mongo";
export * from "./mount";
export * from "./mysql";
export * from "./notification";
export * from "./port";
export * from "./postgres";
export * from "./preview-deployments";
export * from "./project";
export * from "./redirects";
export * from "./redis";
export * from "./registry";
export * from "./rollbacks";
export * from "./schedule";
export * from "./security";
export * from "./server";
export * from "./session";
export * from "./shared";
export * from "./ssh-key";
export * from "./user";
export * from "./utils";
export * from "./volume-backups";

// Add type exports
export type Domain = typeof domains.$inferSelect;
export type User = typeof users.$inferSelect;
export type Redirect = typeof redirects.$inferSelect;
export type Security = typeof security.$inferSelect;
export type Destination = typeof destinations.$inferSelect;

