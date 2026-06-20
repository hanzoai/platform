import { validateRequest } from "@hanzo/platform/lib/auth";
import type { GetServerSidePropsContext } from "next";
import type { ReactElement } from "react";
import { AppsBoard } from "@/components/dashboard/apps/apps-board";
import { DashboardLayout } from "@/components/layouts/dashboard-layout";
import {
	type AppsListResponse,
	listApps,
} from "@/server/apps/apps-api";

/**
 * platform.hanzo.ai/apps — the apps-lifecycle drift view (PR 3 of
 * APPS_LIFECYCLE.md). Renders declared / running / latest / drift per app+env
 * so an operator sees drift "without ssh / kubectl".
 *
 * Data is fetched server-side straight from the apps-api service (the same
 * layer behind /v1/apps) — one data path, one drift authority, no self-HTTP
 * hop. External callers hit /v1/apps for the identical JSON.
 */
export default function AppsPage({ data }: { data: AppsListResponse }) {
	return <AppsBoard apps={data.apps} summary={data.summary} />;
}

AppsPage.getLayout = (page: ReactElement) => {
	return <DashboardLayout>{page}</DashboardLayout>;
};

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
	const { user } = await validateRequest(ctx.req);
	if (!user) {
		return {
			redirect: { permanent: false, destination: "/" },
		};
	}

	// The apps table is per-tenant (contract: each org runs its own). Show the
	// full board for the authenticated operator; org/env/health filtering is
	// available on the /v1/apps API for programmatic callers.
	const data = await listApps({});

	return {
		// Plain JSON (no Date instances) — the service already serializes
		// timestamps to ISO strings, so this is Next-serializable as-is.
		props: { data },
	};
}
