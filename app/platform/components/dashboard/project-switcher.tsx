"use client";

import {
	Check,
	ChevronsUpDown,
	Folder,
	Loader2,
	Plus,
} from "lucide-react";
import Link from "next/link";
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
import { project as projectClient } from "@/utils/zap-project";
import { useProjectContext } from "@/hooks/use-project-context";

export function ProjectSwitcher({ collapsed }: { collapsed?: boolean }) {
	const [open, setOpen] = useState(false);
	const router = useRouter();
	const { activeProjectId, setActiveProject, setActiveEnvironment } = useProjectContext();

	const { data: projects, isPending } = projectClient.all.useQuery();

	const activeProject = projects?.find(
		(p) => p.projectId === activeProjectId,
	);

	const handleProjectSelect = (projectId: string) => {
		const project = projects?.find((p) => p.projectId === projectId);
		if (!project) return;

		setActiveProject(projectId);

		// Auto-select first environment if available
		const envs = project.environments ?? [];
		if (envs.length === 1) {
			setActiveEnvironment(envs[0].environmentId);
			router.push(
				`/dashboard/project/${projectId}/environment/${envs[0].environmentId}`,
			);
		} else if (envs.length > 0) {
			// Select production env if exists, otherwise first
			const prodEnv = envs.find(
				(e: any) => e.name?.toLowerCase() === "production",
			);
			const targetEnv = prodEnv ?? envs[0];
			setActiveEnvironment(targetEnv.environmentId);
			router.push(
				`/dashboard/project/${projectId}/environment/${targetEnv.environmentId}`,
			);
		} else {
			router.push(`/dashboard/projects`);
		}

		setOpen(false);
	};

	if (isPending) {
		return (
			<div className="flex items-center justify-center h-8">
				<Loader2 className="animate-spin size-3 text-muted-foreground" />
			</div>
		);
	}

	if (!projects || projects.length === 0) {
		return null;
	}

	const showSearch = projects.length > 5;

	const serviceCount = (project: any) => {
		const envs = project.environments ?? [];
		let count = 0;
		for (const env of envs) {
			count +=
				(env.applications?.length ?? 0) +
				(env.postgres?.length ?? 0) +
				(env.mysql?.length ?? 0) +
				(env.mariadb?.length ?? 0) +
				(env.mongo?.length ?? 0) +
				(env.redis?.length ?? 0) +
				(env.compose?.length ?? 0);
		}
		return count;
	};

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
						<Folder className={cn("shrink-0", collapsed ? "size-4" : "size-4")} />
						{!collapsed && (
							<span className="text-sm truncate max-w-[130px]">
								{activeProject?.name ?? "Select Project"}
							</span>
						)}
					</div>
					{!collapsed && <ChevronsUpDown className="ml-auto size-3 shrink-0 opacity-50" />}
				</SidebarMenuButton>
			</PopoverTrigger>
			<PopoverContent className="w-[260px] p-0" align="start" side="right" sideOffset={4}>
				<Command>
					{showSearch && <CommandInput placeholder="Search projects..." />}
					<CommandList>
						<CommandEmpty>No projects found.</CommandEmpty>
						<CommandGroup heading="Projects">
							{projects.map((project) => {
								const count = serviceCount(project);
								return (
									<CommandItem
										key={project.projectId}
										value={project.name}
										onSelect={() => handleProjectSelect(project.projectId)}
										className="flex items-center gap-2"
									>
										<Folder className="size-4 shrink-0 text-muted-foreground" />
										<span className="truncate">{project.name}</span>
										{count > 0 && (
											<Badge
												variant="outline"
												className="ml-auto text-[10px] px-1 py-0"
											>
												{count} svc
											</Badge>
										)}
										{activeProjectId === project.projectId && (
											<Check className="ml-auto size-4 shrink-0" />
										)}
									</CommandItem>
								);
							})}
						</CommandGroup>
						<CommandSeparator />
						<CommandGroup>
							<CommandItem
								onSelect={() => {
									setOpen(false);
									router.push("/dashboard/projects");
								}}
								className="cursor-pointer"
							>
								<Plus className="mr-2 size-4" />
								<span>Create Project</span>
							</CommandItem>
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
