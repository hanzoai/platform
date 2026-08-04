/**
 * DashboardLayout — the signed-in shell: the app's navigation (`side.tsx`) plus
 * the two conditional bars that ride above it.
 *
 * It used to ALSO mount `HanzoHeader` and `HanzoCommandPalette` from
 * `@hanzo/ui/navigation`. 8.x drops that subpath, and both were duplicates of
 * chrome this app already has:
 *
 *   • the header restated `side.tsx`'s own `SidebarHeader` — org mark, org
 *     switcher, identity menu (`UserNav` in the `SidebarFooter`) — so a session
 *     was rendered twice, in two places, from two sources;
 *   • the palette was a second ⌘K bound over `SearchCommand`, which `_app.tsx`
 *     already mounts globally and which searches the REAL projects, services and
 *     environments rather than five hardcoded links.
 *
 * One navigation, one palette. The five links the palette hardcoded (Projects,
 * Settings, Monitoring, Users, Docs) are all in the sidebar already.
 */
import { api } from "@/utils/api";
import { ImpersonationBar } from "../dashboard/impersonation/impersonation-bar";
import { HubSpotWidget } from "../shared/HubSpotWidget";
import Page from "./side";

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
			<div className="flex-1">
				<Page>{children}</Page>
				{isChatEnabled && <HubSpotWidget />}
				{haveRootAccess === true && <ImpersonationBar />}
			</div>
		</div>
	);
};
