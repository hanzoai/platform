/**
 * The account control — `UserMenu` from `@hanzo/ui/product`, given platform's
 * identity, its rows and its sign-out.
 *
 * This file used to BE the menu: a shadcn `DropdownMenu` carrying its own
 * trigger, avatar, initials fallback, separators and row markup. Console and
 * hanzo.app already mount the hoisted one, so a person moving between the three
 * surfaces met three account menus that disagreed on the trigger, the row order
 * and the sign-out copy. What is left here is the binding — who is signed in,
 * which rows this deployment offers, and what signing out means.
 *
 * Sign-out stays two-phase and stays in that order: Better Auth's residual
 * session (the api-key/org/sso plugins) first, then the canonical IAM logout,
 * which clears the httpOnly session cookie and redirects to hanzo.id. Auth is
 * unchanged by this file — it moved the menu, not the session.
 */
import { UserMenu, type UserMenuItem } from "@hanzo/ui/product";
import { useRouter } from "next/router";
import { authClient } from "@/lib/auth-client";
import { signOutIam } from "@/lib/iam-browser";
import { api } from "@/utils/api";
import { ModeToggle } from "../ui/modeToggle";
import { useSidebar } from "../ui/sidebar";

export const UserNav = () => {
	const router = useRouter();
	const { data } = api.user.get.useQuery();
	const { data: permissions } = api.user.getPermissions.useQuery();
	const { data: isCloud } = api.settings.isCloud.useQuery();
	const { state, isMobile } = useSidebar();

	// The rail collapses to icons, and the name goes with it — the avatar alone
	// is the trigger at that width, which is what every other row in the rail
	// does. Mobile is never the icon rail, so it keeps the name.
	const collapsed = state === "collapsed" && !isMobile;

	const go =
		(url: string, options?: { shallow?: boolean }) =>
		() =>
			void router.push(url, undefined, options);

	// The surfaces this deployment actually has. A self-hosted install reaches
	// the machine itself; a cloud tenant reaches its servers instead. Same
	// queries and same conditions as before — a row still appears only when the
	// caller may use it, so the menu never offers a dead destination.
	const surfaces: UserMenuItem[] = [
		{
			id: "profile",
			label: "Profile",
			onPress: go("/dashboard/settings/profile"),
		},
		{ id: "projects", label: "Projects", onPress: go("/dashboard/home") },
		...(isCloud
			? permissions?.organization.update
				? [
						{
							id: "servers",
							label: "Servers",
							onPress: go("/dashboard/settings/servers"),
						},
					]
				: []
			: [
					{
						id: "monitoring",
						label: "Monitoring",
						onPress: go("/dashboard/monitoring"),
					},
					...(permissions?.traefikFiles.read
						? [
								{
									id: "traefik",
									label: "Traefik",
									onPress: go("/dashboard/traefik"),
								},
							]
						: []),
					...(permissions?.docker.read
						? [
								{
									id: "docker",
									label: "Docker",
									onPress: go("/dashboard/docker", { shallow: true }),
								},
							]
						: []),
				]),
	];

	// Billing is the org owner's, on cloud only. Its own group, so the rule above
	// it is drawn by the menu rather than by a separator this file places.
	const billing: UserMenuItem[] =
		isCloud && data?.role === "owner"
			? [
					{
						id: "billing",
						label: "Billing",
						onPress: go("/dashboard/settings/billing"),
					},
				]
			: [];

	const name = `${data?.user?.firstName ?? ""} ${data?.user?.lastName ?? ""}`
		.trim();

	return (
		<UserMenu
			name={name || undefined}
			email={data?.user?.email}
			avatar={data?.user?.image || undefined}
			label={!collapsed}
			groups={[surfaces, billing]}
			// Platform's theme is next-themes and this control is its writer, so
			// the menu renders it rather than its own toggle — one writer, one row.
			theme={<ModeToggle />}
			signOutLabel="Log out"
			onSignOut={() => {
				void (async () => {
					await authClient.signOut();
					await signOutIam();
				})();
			}}
		/>
	);
};
