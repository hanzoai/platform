import { api } from "@/utils/api";
import { ImpersonationBar } from "../dashboard/impersonation/impersonation-bar";
import { HubSpotWidget } from "../shared/HubSpotWidget";
import Page from "./side";
import { HanzoHeader, HanzoCommandPalette, useHanzoAuth } from "@hanzo/ui/navigation";
import type { HanzoCommandItem } from "@hanzo/ui/navigation";

const PLATFORM_COMMANDS: HanzoCommandItem[] = [
	{ id: "projects", title: "Projects", description: "View all projects", href: "/dashboard/projects", category: "Platform", keywords: ["project", "app"] },
	{ id: "settings", title: "Settings", description: "Platform settings", href: "/dashboard/settings/server", category: "Platform", keywords: ["config"] },
	{ id: "monitoring", title: "Monitoring", description: "System monitoring", href: "/dashboard/monitoring", category: "Platform", keywords: ["metrics", "logs"] },
	{ id: "users", title: "Users", description: "Manage users", href: "/dashboard/settings/users", category: "Platform", keywords: ["team", "members"] },
	{ id: "docs", title: "Documentation", description: "Platform docs", href: "https://docs.hanzo.ai/platform", category: "Resources", external: true, keywords: ["help", "guide"] },
];

function PlatformHanzoHeader() {
	const { user, organizations, currentOrgId, switchOrg, signOut } = useHanzoAuth();

	return (
		<HanzoHeader
			currentApp="Platform"
			currentAppId="platform"
			user={user}
			organizations={organizations}
			currentOrgId={currentOrgId}
			onOrgSwitch={switchOrg}
			onSignOut={signOut}
		/>
	);
}

interface Props {
	children: React.ReactNode;
	metaName?: string;
}

export const DashboardLayout = ({ children }: Props) => {
	const { data: haveRootAccess } = api.user.haveRootAccess.useQuery();
	const { data: isCloud } = api.settings.isCloud.useQuery();
	const { data: currentPlan } = api.stripe.getCurrentPlan.useQuery(undefined, {
		enabled: isCloud === true,
		refetchOnWindowFocus: false,
		refetchOnMount: false,
		refetchOnReconnect: false,
	});

	const isChatEnabled = isCloud === true && currentPlan === "startup";

	return (
		<div className="flex min-h-dvh flex-col">
			<PlatformHanzoHeader />
			<div className="flex-1">
				<Page>{children}</Page>
				{isChatEnabled && (
					<>
						<HubSpotWidget />
					</>
				)}
				{haveRootAccess === true && <ImpersonationBar />}
			</div>
			<HanzoCommandPalette
				currentAppId="platform"
				commands={PLATFORM_COMMANDS}
			/>
		</div>
	);
};
