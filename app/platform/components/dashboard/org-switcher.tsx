"use client";

import {
	Building2,
	Check,
	ChevronsUpDown,
	Loader2,
	Plus,
	Settings,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
} from "@/components/ui/command";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	SidebarMenuButton,
} from "@/components/ui/sidebar";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { api } from "@/utils/api";
import { organization } from "@/utils/zap-organization";
import { Logo } from "../shared/logo";
import { AddOrganization } from "./organization/handle-organization";
import { DialogAction } from "../shared/dialog-action";

export function OrgSwitcher({ collapsed }: { collapsed?: boolean }) {
	const [open, setOpen] = useState(false);

	const { data: activeOrg } = authClient.useActiveOrganization();
	const { data: session } = authClient.useSession();
	const { data: user } = api.user.get.useQuery();
	const { data: isCloud } = api.settings.isCloud.useQuery();
	const {
		data: organizations,
		refetch,
		isPending,
	} = organization.all.useQuery();
	const { mutateAsync: deleteOrganization, isPending: isRemoving } =
		organization.delete.useMutation();
	const utils = api.useUtils();

	const handleOrgSwitch = async (orgId: string) => {
		await authClient.organization.setActive({ organizationId: orgId });
		await utils.invalidate();
		setOpen(false);
		// Soft reload to pick up new org context in SSR pages
		window.location.href = "/dashboard/projects";
	};

	if (isPending) {
		return (
			<div className="flex items-center justify-center h-10">
				<Loader2 className="animate-spin size-4 text-muted-foreground" />
			</div>
		);
	}

	const showSearch = (organizations?.length ?? 0) > 5;

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<SidebarMenuButton
					size={collapsed ? "sm" : "lg"}
					className={cn(
						"data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground w-full",
						collapsed && "flex justify-center items-center p-2 h-10 w-10 mx-auto",
					)}
				>
					<div className={cn("flex items-center gap-2", collapsed && "justify-center")}>
						<div className="flex items-center justify-center rounded-sm border size-6 shrink-0">
							<Logo
								className={cn("transition-all", collapsed ? "size-4" : "size-5")}
								logoUrl={activeOrg?.logo || undefined}
							/>
						</div>
						{!collapsed && (
							<div className="flex flex-col items-start min-w-0">
								<p className="text-sm font-medium leading-none truncate max-w-[140px]">
									{activeOrg?.name ?? "Select Organization"}
								</p>
							</div>
						)}
					</div>
					{!collapsed && <ChevronsUpDown className="ml-auto size-4 shrink-0 opacity-50" />}
				</SidebarMenuButton>
			</PopoverTrigger>
			<PopoverContent className="w-[260px] p-0" align="start" side="right" sideOffset={4}>
				<Command>
					{showSearch && <CommandInput placeholder="Search organizations..." />}
					<CommandList>
						<CommandEmpty>No organizations found.</CommandEmpty>
						<CommandGroup heading="Organizations">
							{organizations?.map(
								(org: {
									id: string;
									name: string;
									logo?: string | null;
									ownerId?: string;
								}) => (
								<CommandItem
									key={org.id}
									value={org.name}
									onSelect={() => handleOrgSwitch(org.id)}
									className="flex items-center gap-2"
								>
									<div className="flex items-center justify-center rounded-sm border size-6 shrink-0">
										<Logo className="size-4" logoUrl={org.logo ?? undefined} />
									</div>
									<span className="truncate">{org.name}</span>
									{org.ownerId === session?.user?.id && (
										<Badge variant="secondary" className="ml-auto text-[10px] px-1 py-0">
											Owner
										</Badge>
									)}
									{activeOrg?.id === org.id && (
										<Check className="ml-auto size-4 shrink-0" />
									)}
								</CommandItem>
							))}
						</CommandGroup>
						{(user?.role === "owner" || isCloud) && (
							<>
								<CommandSeparator />
								<CommandGroup>
									<AddOrganization />
								</CommandGroup>
							</>
						)}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
