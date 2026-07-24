import { validateRequest } from "@hanzo/platform/lib/auth";
import { HandCoins } from "lucide-react";
import type { GetServerSidePropsContext } from "next";
import Link from "next/link";
import { useRouter } from "next/router";
import { type ReactElement, useEffect, useState } from "react";
import { DashboardLayout } from "@/components/layouts/dashboard-layout";
import { TemplateDeployDialog } from "@/components/templates/template-deploy-dialog";
import {
	TemplateGallery,
	type TemplateSummary,
} from "@/components/templates/template-gallery";
import { Button } from "@/components/ui/button";
import { api } from "@/utils/api";

/**
 * Prominent creator-payout funnel — the marketplace differentiator. Honest
 * copy (a share of compute margin, no fabricated earnings); the CTA hands off
 * to the live AuthorsModule payout product on console.hanzo.ai.
 */
function PayoutBanner() {
	return (
		<div className="flex flex-col md:flex-row md:items-center justify-between gap-4 rounded-xl border bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-6">
			<div className="flex items-start gap-4">
				<div className="rounded-lg bg-primary/10 p-3">
					<HandCoins className="size-6 text-primary" />
				</div>
				<div className="flex flex-col gap-1">
					<h2 className="text-lg font-semibold">
						Built one of these? Get paid when people run it.
					</h2>
					<p className="text-sm text-muted-foreground max-w-2xl">
						Earn 20% of the compute margin when people deploy your open-source
						project on Hanzo Cloud — paid straight to your Hanzo wallet.
					</p>
				</div>
			</div>
			<Button asChild size="lg" className="shrink-0">
				<Link href="https://console.hanzo.ai/authors" target="_blank">
					Claim your project
				</Link>
			</Button>
		</div>
	);
}

export default function TemplatesPage() {
	const router = useRouter();
	const [selected, setSelected] = useState<{
		template: TemplateSummary;
		baseUrl?: string;
	} | null>(null);

	// Resolve the `?deploy=<id>` deep link against the shared catalog query
	// (same query key as TemplateGallery → one fetch, cache-shared).
	const { data: templates } = api.compose.templates.useQuery({
		baseUrl: undefined,
	});

	useEffect(() => {
		const deployId = router.query.deploy;
		if (typeof deployId !== "string" || selected) return;
		const match = (templates as TemplateSummary[] | undefined)?.find(
			(t) => t.id === deployId,
		);
		if (match) setSelected({ template: match });
	}, [router.query.deploy, templates, selected]);

	const closeDeploy = () => {
		setSelected(null);
		if (router.query.deploy) {
			const { deploy: _deploy, ...rest } = router.query;
			router.replace({ pathname: router.pathname, query: rest }, undefined, {
				shallow: true,
			});
		}
	};

	return (
		<div className="flex flex-col gap-6">
			<div>
				<h1 className="text-2xl font-bold">OSS Templates</h1>
				<p className="text-muted-foreground">
					Browse 1000+ open-source apps and deploy in one click.
				</p>
			</div>

			<PayoutBanner />

			<TemplateGallery
				enabled
				showFeaturedTags
				showPayoutHook
				renderAction={(template, baseUrl) => (
					<Button size="sm" onClick={() => setSelected({ template, baseUrl })}>
						Deploy
					</Button>
				)}
			/>

			<TemplateDeployDialog
				template={selected?.template ?? null}
				baseUrl={selected?.baseUrl}
				onOpenChange={(open) => {
					if (!open) closeDeploy();
				}}
			/>
		</div>
	);
}

TemplatesPage.getLayout = (page: ReactElement) => {
	return <DashboardLayout>{page}</DashboardLayout>;
};

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
	const { user } = await validateRequest(ctx.req);
	if (!user) {
		return {
			redirect: { permanent: false, destination: "/" },
		};
	}
	return { props: {} };
}
