import { db } from "@/server/db";
import { organization, server } from "@/server/db/schema";
import { asc, eq } from "drizzle-orm";
import type { Server } from "@hanzo/platform";

export const WEBSITE_URL =
	process.env.NODE_ENV === "development"
		? "http://localhost:3000"
		: process.env.SITE_URL;

const activateServer = async (serverId: string) => {
	await db
		.update(server)
		.set({ serverStatus: "active" })
		.where(eq(server.serverId, serverId));
};

const deactivateServer = async (serverId: string) => {
	await db
		.update(server)
		.set({ serverStatus: "inactive" })
		.where(eq(server.serverId, serverId));
};

export const findServersByUserIdSorted = async (userId: string) => {
	const organizations = await db.query.organization.findMany({
		where: eq(organization.ownerId, userId),
	});

	const servers: Server[] = [];
	for (const org of organizations) {
		const serversByOrg = await db.query.server.findMany({
			where: eq(server.organizationId, org.id),
			orderBy: asc(server.createdAt),
		});
		servers.push(...serversByOrg);
	}

	return servers;
};

export const updateServersBasedOnQuantity = async (
	userId: string,
	newServersQuantity: number,
) => {
	const servers = await findServersByUserIdSorted(userId);

	if (servers.length > newServersQuantity) {
		for (const [index, srv] of servers.entries()) {
			if (index < newServersQuantity) {
				await activateServer(srv.serverId);
			} else {
				await deactivateServer(srv.serverId);
			}
		}
	} else {
		for (const srv of servers) {
			await activateServer(srv.serverId);
		}
	}
};
