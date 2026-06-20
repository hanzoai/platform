import { validateRequest } from "@hanzo/platform/lib/auth";
import { createServerSideHelpers } from "@trpc/react-query/server";
import type { GetServerSidePropsContext } from "next";
import type { ReactElement } from "react";
import superjson from "superjson";
import { ShowApps } from "@/components/dashboard/apps/show";
import { DashboardLayout } from "@/components/layouts/dashboard-layout";
import { appRouter } from "@/server/api/root";

/**
 * /apps — the apps-lifecycle drift view (`docs/APPS_LIFECYCLE.md` §6).
 *
 * The "observe" surface of the control plane: every service × env with declared
 * vs running vs latest version and a loud drift indicator. Reads the `apps.all`
 * tRPC procedure (same data path as REST `/v1/apps`). SSR-prefetched so the
 * table is populated on first paint; the client query keeps it live.
 */
const AppsPage = () => {
	return (
		<div className="flex flex-col gap-6">
			<div>
				<h1 className="text-3xl font-bold">Apps</h1>
				<p className="text-muted-foreground">
					Declared, running, and latest versions across every service and
					environment — with drift surfaced immediately.
				</p>
			</div>
			<ShowApps />
		</div>
	);
};

export default AppsPage;

AppsPage.getLayout = (page: ReactElement) => {
	return <DashboardLayout>{page}</DashboardLayout>;
};

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
	const { req, res } = ctx;
	const { user, session } = await validateRequest(req);

	if (!user || !session) {
		return {
			redirect: { permanent: false, destination: "/" },
		};
	}

	const helpers = createServerSideHelpers({
		router: appRouter,
		ctx: {
			req: req as any,
			res: res as any,
			db: null as any,
			session: session as any,
			user: user as any,
		},
		transformer: superjson,
	});

	await helpers.apps.all.prefetch({});

	return {
		props: { trpcState: helpers.dehydrate() },
	};
}
