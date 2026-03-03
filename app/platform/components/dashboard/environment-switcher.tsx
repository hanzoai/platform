"use client";

import {
	Check,
	ChevronsUpDown,
	GitBranch,
	Loader2,
	Plus,
} from "lucide-react";
import { useRouter } from "next/router";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
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
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { api } from "@/utils/api";
import { useProjectContext } from "@/hooks/use-project-context";

export function EnvironmentSwitcher({ collapsed }: { collapsed?: boolean }) {
	const [open, setOpen] = useState(false);
	const router = useRouter();
	const { activeProjectId, activeEnvironmentId, setActiveEnvironment } =
		useProjectContext();

	const { data: environments, isLoading } =
		api.environment.byProjectId.useQuery(
			{ projectId: activeProjectId ?? "" },
			{ enabled: !!activeProjectId },
		);

	const activeEnv = environments?.find(
		(e: any) => e.environmentId === activeEnvironmentId,
	);

	const handleEnvSelect = (environmentId: string) => {
		setActiveEnvironment(environmentId);
		if (activeProjectId) {
			router.push(
				`/dashboard/project/${activeProjectId}/environment/${environmentId}`,
			);
		}
		setOpen(false);
	};

	// Don't show if no project selected
	if (!activeProjectId) return null;

	if (isLoading) {
		return (
			<div className="flex items-center justify-center h-8">
				<Loader2 className="animate-spin size-3 text-muted-foreground" />
			</div>
		);
	}

	if (!environments || environments.length === 0) return null;

	// If only one environment, show it but don't make it a dropdown
	if (environments.length === 1) {
		const env = environments[0] as any;
		return (
			<SidebarMenuButton
				size="sm"
				className={cn(
					"w-full cursor-default",
					collapsed && "flex justify-center items-center p-2 h-8 w-8 mx-auto",
				)}
			>
				<div className={cn("flex items-center gap-2", collapsed && "justify-center")}>
					<GitBranch className="size-3 shrink-0 text-muted-foreground" />
					{!collapsed && (
						<span className="text-xs text-muted-foreground truncate max-w-[130px]">
							{env.name}
						</span>
					)}
				</div>
			</SidebarMenuButton>
		);
	}

	const serviceCount = (env: any) =>
		(env.applications?.length ?? 0) +
		(env.postgres?.length ?? 0) +
		(env.mysql?.length ?? 0) +
		(env.mariadb?.length ?? 0) +
		(env.mongo?.length ?? 0) +
		(env.redis?.length ?? 0) +
		(env.compose?.length ?? 0);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<SidebarMenuButton
					size="sm"
					className={cn(
						"data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground w-full",
						collapsed && "flex justify-center items-center p-2 h-8 w-8 mx-auto",
					)}
				>
					<div className={cn("flex items-center gap-2", collapsed && "justify-center")}>
						<GitBranch className="size-3 shrink-0" />
						{!collapsed && (
							<span className="text-xs truncate max-w-[130px]">
								{activeEnv
									? (activeEnv as any).name
									: "Select Environment"}
							</span>
						)}
					</div>
					{!collapsed && <ChevronsUpDown className="ml-auto size-3 shrink-0 opacity-50" />}
				</SidebarMenuButton>
			</PopoverTrigger>
			<PopoverContent className="w-[240px] p-0" align="start" side="right" sideOffset={4}>
				<Command>
					<CommandList>
						<CommandEmpty>No environments found.</CommandEmpty>
						<CommandGroup heading="Environments">
							{environments.map((env: any) => {
								const count = serviceCount(env);
								const isProd = env.name?.toLowerCase() === "production";
								return (
									<CommandItem
										key={env.environmentId}
										value={env.name}
										onSelect={() => handleEnvSelect(env.environmentId)}
										className="flex items-center gap-2"
									>
										<GitBranch className="size-3 shrink-0 text-muted-foreground" />
										<span className="truncate">{env.name}</span>
										{isProd && (
											<Badge
												variant="secondary"
												className="text-[10px] px-1 py-0"
											>
												prod
											</Badge>
										)}
										{count > 0 && (
											<Badge
												variant="outline"
												className="ml-auto text-[10px] px-1 py-0"
											>
												{count}
											</Badge>
										)}
										{activeEnvironmentId === env.environmentId && (
											<Check className="ml-auto size-3 shrink-0" />
										)}
									</CommandItem>
								);
							})}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
