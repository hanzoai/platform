import { validateRequest } from "@hanzo/platform";
import { createServerSideHelpers } from "@trpc/react-query/server";
import type { GetServerSidePropsContext } from "next";
import type { ReactElement } from "react";
import superjson from "superjson";
import { ShowGateway } from "@/components/dashboard/settings/gateway/show-gateway";
import { DashboardLayout } from "@/components/layouts/dashboard-layout";
import { appRouter } from "@/server/api/root";
import { getLocale, serverSideTranslations } from "@/utils/i18n";

const Page = () => {
	return (
		<div className="flex flex-col gap-4 w-full">
			<ShowGateway />
		</div>
	);
};

export default Page;

Page.getLayout = (page: ReactElement) => {
	return <DashboardLayout metaName="Gateway">{page}</DashboardLayout>;
};

export async function getServerSideProps(
	ctx: GetServerSidePropsContext<{ serviceId: string }>,
) {
	const { req, res } = ctx;
	const locale = await getLocale(req.cookies);
	const { user, session } = await validateRequest(req);
	if (!user) {
		return {
			redirect: {
				permanent: true,
				destination: "/",
			},
		};
	}
	if (user.role === "member") {
		return {
			redirect: {
				permanent: true,
				destination: "/dashboard/settings/profile",
			},
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
	await helpers.user.get.prefetch();
	await helpers.settings.isCloud.prefetch();
	// gateway.* moved to the native ZAP `gateway` capability (utils/zap-gateway);
	// its data is fetched client-side via the zap hooks, no tRPC prefetch.

	return {
		props: {
			trpcState: helpers.dehydrate(),
			...(await serverSideTranslations(locale, ["settings"])),
		},
	};
}
