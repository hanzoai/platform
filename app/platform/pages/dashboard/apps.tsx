import { validateRequest } from "@hanzo/platform/lib/auth";
import type { GetServerSidePropsContext } from "next";
import type { ReactElement } from "react";
import { AppsBoard } from "@/components/dashboard/apps/apps-board";
import { DashboardLayout } from "@/components/layouts/dashboard-layout";
import { type AppsListResponse, listApps } from "@/server/apps/apps-api";

/**
 * /apps — the apps-lifecycle drift view (PR 3 of APPS_LIFECYCLE.md), the
 * "observe" surface of the control plane.
 *
 * The page physically lives under the dashboard shell (so it sits beside
 * /dashboard/home and /dashboard/projects); the canonical URL
 * `platform.hanzo.ai/apps` is mapped onto it by the `/apps -> /dashboard/apps`
 * rewrite in next.config.mjs, and the sidebar "Apps" entry links here.
 *
 * Data is fetched server-side straight from the apps-api service — the SAME
 * layer behind REST /v1/apps — so there is one data path and one drift
 * authority (`computeDrift`), with no self-HTTP hop. External callers hit
 * /v1/apps for the identical JSON.
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

	// The control-plane board shows every service x env for the authenticated
	// operator; org/env/health filtering is available on /v1/apps for
	// programmatic callers. Wrapped like the REST handlers (app/v1/apps/route.ts)
	// so a transient DB blip — or the apps table not yet migrated on a fresh
	// image — renders an empty board (which AppsBoard handles) instead of a 500.
	let data: AppsListResponse;
	try {
		data = await listApps({});
	} catch (err) {
		console.error("[/dashboard/apps] listApps failed", err);
		data = { apps: [], summary: { total: 0, byDrift: { ok: 0, yellow: 0, red: 0 } } };
	}

	return {
		// Plain JSON (no Date instances) — the service serializes timestamps to
		// ISO strings, so this is Next-serializable as-is.
		props: { data },
	};
}
