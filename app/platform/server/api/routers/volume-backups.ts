import {
	createVolumeBackup,
	findApplicationById,
	findComposeById,
	findMariadbById,
	findMongoById,
	findMySqlById,
	findPostgresById,
	findRedisById,
	findVolumeBackupById,
	IS_CLOUD,
	removeVolumeBackup,
	removeVolumeBackupJob,
	restoreVolume,
	runVolumeBackup,
	scheduleVolumeBackup,
	updateVolumeBackup,
} from "@hanzo/platform";
import { db } from "@hanzo/platform/db";
import {
	createVolumeBackupSchema,
	updateVolumeBackupSchema,
	volumeBackups,
} from "@hanzo/platform/db/schema";
import {
	execAsyncRemote,
	execAsyncStream,
} from "@hanzo/platform/utils/process/execAsync";
import { TRPCError } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/api/utils/audit";
import { removeJob, schedule, updateJob } from "@/server/utils/backup";
import { createTRPCRouter, protectedProcedure, withPermission } from "../trpc";

/**
 * Resolve the organizationId for a volume backup by looking up its parent service.
 */
async function getVolumeBackupOrgId(
	vb: {
		applicationId?: string | null;
		postgresId?: string | null;
		mysqlId?: string | null;
		mariadbId?: string | null;
		mongoId?: string | null;
		redisId?: string | null;
		composeId?: string | null;
	},
): Promise<string> {
	if (vb.applicationId) {
		const app = await findApplicationById(vb.applicationId);
		return app.environment.project.organizationId;
	}
	if (vb.postgresId) {
		const pg = await findPostgresById(vb.postgresId);
		return pg.environment.project.organizationId;
	}
	if (vb.mysqlId) {
		const my = await findMySqlById(vb.mysqlId);
		return my.environment.project.organizationId;
	}
	if (vb.mariadbId) {
		const maria = await findMariadbById(vb.mariadbId);
		return maria.environment.project.organizationId;
	}
	if (vb.mongoId) {
		const mongo = await findMongoById(vb.mongoId);
		return mongo.environment.project.organizationId;
	}
	if (vb.redisId) {
		const redis = await findRedisById(vb.redisId);
		return redis.environment.project.organizationId;
	}
	if (vb.composeId) {
		const compose = await findComposeById(vb.composeId);
		return compose.environment.project.organizationId;
	}
	throw new TRPCError({
		code: "BAD_REQUEST",
		message: "Cannot determine volume backup ownership",
	});
}

function assertVbOrgMatch(orgId: string, activeOrgId: string): void {
	if (orgId !== activeOrgId) {
		throw new TRPCError({
			code: "UNAUTHORIZED",
			message: "You are not authorized to access this volume backup",
		});
	}
}

/**
 * Resolve org for a service type + id pair used in the list endpoint.
 */
async function getServiceOrgId(
	serviceType: string,
	id: string,
): Promise<string> {
	switch (serviceType) {
		case "application": {
			const app = await findApplicationById(id);
			return app.environment.project.organizationId;
		}
		case "postgres": {
			const pg = await findPostgresById(id);
			return pg.environment.project.organizationId;
		}
		case "mysql": {
			const my = await findMySqlById(id);
			return my.environment.project.organizationId;
		}
		case "mariadb": {
			const maria = await findMariadbById(id);
			return maria.environment.project.organizationId;
		}
		case "mongo": {
			const mongo = await findMongoById(id);
			return mongo.environment.project.organizationId;
		}
		case "redis": {
			const redis = await findRedisById(id);
			return redis.environment.project.organizationId;
		}
		case "compose": {
			const compose = await findComposeById(id);
			return compose.environment.project.organizationId;
		}
		default:
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Unknown service type",
			});
	}
}

export const volumeBackupsRouter = createTRPCRouter({
	list: protectedProcedure
		.input(
			z.object({
				id: z.string().min(1),
				volumeBackupType: z.enum([
					"application",
					"postgres",
					"mysql",
					"mariadb",
					"mongo",
					"redis",
					"compose",
					"libsql",
				]),
			}),
		)
		.query(async ({ input, ctx }) => {
			// Verify the parent service belongs to the caller's org
			const orgId = await getServiceOrgId(input.volumeBackupType, input.id);
			assertVbOrgMatch(orgId, ctx.session.activeOrganizationId);

			return await db.query.volumeBackups.findMany({
				where: eq(volumeBackups[`${input.volumeBackupType}Id`], input.id),
				with: {
					application: true,
					postgres: true,
					mysql: true,
					mariadb: true,
					mongo: true,
					redis: true,
					compose: true,
					libsql: true,
				},
				orderBy: [desc(volumeBackups.createdAt)],
			});
		}),
	create: protectedProcedure
		.input(createVolumeBackupSchema)
		.mutation(async ({ input, ctx }) => {
			const newVolumeBackup = await createVolumeBackup(input);
			if (!newVolumeBackup) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to create volume backup",
				});
			}

			// Verify org ownership on the newly created volume backup
			const orgId = await getVolumeBackupOrgId(newVolumeBackup);
			assertVbOrgMatch(orgId, ctx.session.activeOrganizationId);

			if (newVolumeBackup?.enabled) {
				if (IS_CLOUD) {
					await schedule({
						cronSchedule: newVolumeBackup.cronExpression,
						volumeBackupId: newVolumeBackup.volumeBackupId,
						type: "volume-backup",
					});
				} else {
					await scheduleVolumeBackup(newVolumeBackup.volumeBackupId);
				}
			}
			await audit(ctx, {
				action: "create",
				resourceType: "volumeBackup",
				resourceId: newVolumeBackup?.volumeBackupId,
			});
			return newVolumeBackup;
		}),
	one: protectedProcedure
		.input(
			z.object({
				volumeBackupId: z.string().min(1),
			}),
		)
		.query(async ({ input, ctx }) => {
			const vb = await findVolumeBackupById(input.volumeBackupId);
			const orgId = await getVolumeBackupOrgId(vb);
			assertVbOrgMatch(orgId, ctx.session.activeOrganizationId);
			return vb;
		}),
	delete: protectedProcedure
		.input(
			z.object({
				volumeBackupId: z.string().min(1),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const vb = await findVolumeBackupById(input.volumeBackupId);
			const orgId = await getVolumeBackupOrgId(vb);
			assertVbOrgMatch(orgId, ctx.session.activeOrganizationId);
			return await removeVolumeBackup(input.volumeBackupId);
		}),
	update: protectedProcedure
		.input(updateVolumeBackupSchema)
		.mutation(async ({ input, ctx }) => {
			// Verify org ownership before update
			const existingVb = await findVolumeBackupById(input.volumeBackupId);
			const vbOrgId = await getVolumeBackupOrgId(existingVb);
			assertVbOrgMatch(vbOrgId, ctx.session.activeOrganizationId);

			const updatedVolumeBackup = await updateVolumeBackup(
				input.volumeBackupId,
				input,
			);

			if (!updatedVolumeBackup) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Volume backup not found",
				});
			}

			if (IS_CLOUD) {
				if (updatedVolumeBackup.enabled) {
					await updateJob({
						cronSchedule: updatedVolumeBackup.cronExpression,
						volumeBackupId: updatedVolumeBackup.volumeBackupId,
						type: "volume-backup",
					});
				} else {
					await removeJob({
						cronSchedule: updatedVolumeBackup.cronExpression,
						volumeBackupId: updatedVolumeBackup.volumeBackupId,
						type: "volume-backup",
					});
				}
			} else {
				if (updatedVolumeBackup?.enabled) {
					removeVolumeBackupJob(updatedVolumeBackup.volumeBackupId);
					scheduleVolumeBackup(updatedVolumeBackup.volumeBackupId);
				} else {
					removeVolumeBackupJob(updatedVolumeBackup.volumeBackupId);
				}
			}
			await audit(ctx, {
				action: "update",
				resourceType: "volumeBackup",
				resourceId: updatedVolumeBackup.volumeBackupId,
			});
			return updatedVolumeBackup;
		}),

	runManually: protectedProcedure
		.input(z.object({ volumeBackupId: z.string().min(1) }))
		.mutation(async ({ input, ctx }) => {
			const vb = await findVolumeBackupById(input.volumeBackupId);
			const orgId = await getVolumeBackupOrgId(vb);
			assertVbOrgMatch(orgId, ctx.session.activeOrganizationId);

			try {
				const result = await runVolumeBackup(input.volumeBackupId);
				await audit(ctx, {
					action: "run",
					resourceType: "volumeBackup",
					resourceId: input.volumeBackupId,
				});
				return result;
			} catch (error) {
				console.error(error);
				return false;
			}
		}),
	restoreVolumeBackupWithLogs: withPermission("volumeBackup", "restore")
		.meta({
			openapi: {
				enabled: false,
				path: "/restore-volume-backup-with-logs",
				method: "POST",
				override: true,
			},
		})
		.input(
			z.object({
				backupFileName: z.string().min(1),
				destinationId: z.string().min(1),
				volumeName: z.string().min(1),
				id: z.string().min(1),
				serviceType: z.enum(["application", "compose"]),
				serverId: z.string().optional(),
			}),
		)
		.subscription(async ({ input, ctx }) => {
			// Verify org ownership for the parent service
			const orgId = await getServiceOrgId(input.serviceType, input.id);
			assertVbOrgMatch(orgId, ctx.session.activeOrganizationId);

			return observable<string>((emit) => {
				const runRestore = async () => {
					try {
						emit.next("🚀 Starting volume restore process...");
						emit.next(`📂 Backup File: ${input.backupFileName}`);
						emit.next(`🔧 Volume Name: ${input.volumeName}`);
						emit.next(`🏷️ Service Type: ${input.serviceType}`);
						emit.next(""); // Empty line for better readability

						// Generate the restore command
						const restoreCommand = await restoreVolume(
							input.id,
							input.destinationId,
							input.volumeName,
							input.backupFileName,
							input.serverId || "",
							input.serviceType,
						);

						emit.next("📋 Generated restore command:");
						emit.next("▶️ Executing restore...");
						emit.next(""); // Empty line

						// Execute the restore command with real-time output
						if (input.serverId) {
							emit.next(`🌐 Executing on remote server: ${input.serverId}`);
							await execAsyncRemote(input.serverId, restoreCommand, (data) => {
								emit.next(data);
							});
						} else {
							emit.next("🖥️ Executing on local server");
							await execAsyncStream(restoreCommand, (data) => {
								emit.next(data);
							});
						}

						emit.next("");
						emit.next("✅ Volume restore completed successfully!");
						emit.next(
							"🎉 All containers/services have been restarted with the restored volume.",
						);
					} catch {
						emit.next("");
						emit.next("❌ Volume restore failed!");
					} finally {
						emit.complete();
					}
				};

				// Start the restore process
				runRestore();
			});
		}),
});
