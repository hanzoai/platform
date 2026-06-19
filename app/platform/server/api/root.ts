import { createTRPCRouter } from "../api/trpc";
import { adminRouter } from "./routers/admin";
// aiRouter migrated to native @zap-proto/web (server/zap/ai-cap.ts).
import { applicationRouter } from "./routers/application";
import { backupRouter } from "./routers/backup";
import { billingRouter } from "./routers/billing";
import { buildJobRouter } from "./routers/build-job";
import { bitbucketRouter } from "./routers/bitbucket";
import { certificateRouter } from "./routers/certificate";
// clusterRouter migrated to native @zap-proto/web (server/zap/cluster-cap.ts).
import { composeRouter } from "./routers/compose";
import { deployProviderRouter } from "./routers/deploy-provider";
import { deploymentRouter } from "./routers/deployment";
// destinationRouter migrated to native @zap-proto/web (server/zap/destination-cap.ts).
// digitaloceanRouter migrated to native @zap-proto/web (server/zap/digitalocean-cap.ts).
// dnsRouter migrated to native @zap-proto/web (server/zap/dns-cap.ts).
import { dockerRouter } from "./routers/docker";
// doksRouter migrated to native @zap-proto/web (server/zap/doks-cap.ts).
import { domainRouter } from "./routers/domain";
import { environmentRouter } from "./routers/environment";
// gatewayRouter migrated to native @zap-proto/web (server/zap/gateway-cap.ts).
import { gitProviderRouter } from "./routers/git-provider";
import { giteaRouter } from "./routers/gitea";
import { githubRouter } from "./routers/github";
import { gitlabRouter } from "./routers/gitlab";
import { libsqlRouter } from "./routers/libsql";
import { mariadbRouter } from "./routers/mariadb";
import { mongoRouter } from "./routers/mongo";
import { mountRouter } from "./routers/mount";
import { mysqlRouter } from "./routers/mysql";
import { notificationRouter } from "./routers/notification";
import { organizationRouter } from "./routers/organization";
import { patchRouter } from "./routers/patch";
import { portRouter } from "./routers/port";
import { postgresRouter } from "./routers/postgres";
import { previewDeploymentRouter } from "./routers/preview-deployment";
import { projectRouter } from "./routers/project";
import { auditLogRouter } from "./routers/enterprise/audit-log";
import { customRoleRouter } from "./routers/enterprise/custom-role";
import { licenseKeyRouter } from "./routers/enterprise/license-key";
import { ssoRouter } from "./routers/enterprise/sso";
import { whitelabelingRouter } from "./routers/enterprise/whitelabeling";
import { redirectsRouter } from "./routers/redirects";
import { redisRouter } from "./routers/redis";
// registryRouter migrated to native @zap-proto/web (server/zap/registry-cap.ts).
import { rollbackRouter } from "./routers/rollbacks";
import { scheduleRouter } from "./routers/schedule";
import { securityRouter } from "./routers/security";
import { serverRouter } from "./routers/server";
import { settingsRouter } from "./routers/settings";
import { sshRouter } from "./routers/ssh-key";
import { stripeRouter } from "./routers/stripe";
import { swarmRouter } from "./routers/swarm";
import { tagRouter } from "./routers/tag";
import { userRouter } from "./routers/user";
import { volumeBackupsRouter } from "./routers/volume-backups";
/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */

export const appRouter = createTRPCRouter({
	admin: adminRouter,
	// digitalocean: migrated to native @zap-proto/web — see utils/zap-digitalocean.ts
	// (browser) and server/zap/digitalocean-cap.ts (server).
	// dns: migrated to native @zap-proto/web — see utils/zap-dns.ts (browser)
	// and server/zap/dns-cap.ts (server). No tRPC dns router remains.
	// gateway: migrated to native @zap-proto/web — see utils/zap-gateway.ts
	// (browser) and server/zap/gateway-cap.ts (server). No tRPC gateway router.
	docker: dockerRouter,
	// doks: migrated to native @zap-proto/web — see utils/zap.ts (browser) and
	// server/zap/doks-cap.ts (server). No tRPC doks router remains.
	project: projectRouter,
	application: applicationRouter,
	backup: backupRouter,
	buildJob: buildJobRouter,
	bitbucket: bitbucketRouter,
	certificates: certificateRouter,
	// cluster: migrated to native @zap-proto/web — see utils/zap-cluster.ts
	// (browser) and server/zap/cluster-cap.ts (server). No tRPC cluster router.
	compose: composeRouter,
	deployProvider: deployProviderRouter,
	deployment: deploymentRouter,
	// destination: migrated to native @zap-proto/web — see utils/zap-destination.ts
	// (browser) and server/zap/destination-cap.ts (server).
	domain: domainRouter,
	gitea: giteaRouter,
	gitProvider: gitProviderRouter,
	github: githubRouter,
	gitlab: gitlabRouter,
	libsql: libsqlRouter,
	mariadb: mariadbRouter,
	mongo: mongoRouter,
	mounts: mountRouter,
	mysql: mysqlRouter,
	notification: notificationRouter,
	port: portRouter,
	postgres: postgresRouter,
	previewDeployment: previewDeploymentRouter,
	redirects: redirectsRouter,
	redis: redisRouter,
	// registry: migrated to native @zap-proto/web — see utils/zap-registry.ts
	// (browser) and server/zap/registry-cap.ts (server).
	security: securityRouter,
	server: serverRouter,
	settings: settingsRouter,
	sshKey: sshRouter,
	stripe: stripeRouter,
	billing: billingRouter,
	swarm: swarmRouter,
	user: userRouter,
	// ai: migrated to native @zap-proto/web — see utils/zap-ai.ts (browser)
	// and server/zap/ai-cap.ts (server). No tRPC ai router remains.
	organization: organizationRouter,
	licenseKey: licenseKeyRouter,
	sso: ssoRouter,
	whitelabeling: whitelabelingRouter,
	customRole: customRoleRouter,
	auditLog: auditLogRouter,
	schedule: scheduleRouter,
	rollback: rollbackRouter,
	volumeBackups: volumeBackupsRouter,
	environment: environmentRouter,
	tag: tagRouter,
	patch: patchRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
