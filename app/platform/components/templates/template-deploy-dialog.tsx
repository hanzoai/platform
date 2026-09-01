"use client";

import { Label } from "@hanzo/ui";
import { HelpCircle } from "lucide-react";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { HandleProject } from "@/components/dashboard/projects/handle-project";
import { AlertBlock } from "@/components/shared/alert-block";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/utils/api";
import type { TemplateSummary } from "./template-gallery";

interface Props {
	/** The template to deploy; the dialog is open while this is non-null. */
	template: TemplateSummary | null;
	onOpenChange: (open: boolean) => void;
	/** Catalog base URL for self-hosted registries; forwarded to the mutation. */
	baseUrl?: string;
	/**
	 * Deploy into this fixed environment and skip the project/environment
	 * picker — used by the in-project "Create from Template" dialog. When
	 * omitted, the picker is shown (standalone marketplace).
	 */
	environmentId?: string;
	/**
	 * Called after a successful deploy. When provided (fixed-environment mode)
	 * the dialog defers navigation to the caller; otherwise the marketplace
	 * routes to the freshly-populated environment.
	 */
	onDeployed?: () => void;
}

/**
 * The one-and-only template deploy path. Reuses `api.compose.deployTemplate`
 * verbatim; the only branch is where the target environment comes from — a
 * fixed prop (in-project dialog) or a project/environment picker (marketplace).
 */
export function TemplateDeployDialog({
	template,
	onOpenChange,
	baseUrl,
	environmentId,
	onDeployed,
}: Props) {
	const router = useRouter();
	const pickerMode = !environmentId;

	const { data: isCloud } = api.settings.isCloud.useQuery();
	const { data: servers } = api.server.withSSHKey.useQuery();
	const { data: projects, isLoading: isLoadingProjects } =
		api.project.all.useQuery(undefined, { enabled: pickerMode });

	const [serverId, setServerId] = useState<string | undefined>(undefined);
	const [projectId, setProjectId] = useState<string | undefined>(undefined);
	const [envId, setEnvId] = useState<string | undefined>(undefined);

	const { mutateAsync, isPending, error, isError } =
		api.compose.deployTemplate.useMutation();

	const environments = useMemo(
		() => projects?.find((p) => p.projectId === projectId)?.environments ?? [],
		[projects, projectId],
	);

	// Preselect the first project + its default environment once the list loads.
	useEffect(() => {
		if (!pickerMode || !template || !projects?.length) return;
		if (projectId) return;
		const firstProject = projects[0];
		if (!firstProject) return;
		setProjectId(firstProject.projectId);
		const defaultEnv =
			firstProject.environments.find((e) => e.isDefault) ??
			firstProject.environments[0];
		setEnvId(defaultEnv?.environmentId);
	}, [pickerMode, template, projects, projectId]);

	// Reset selections each time the dialog is dismissed.
	useEffect(() => {
		if (!template) {
			setProjectId(undefined);
			setEnvId(undefined);
			setServerId(undefined);
		}
	}, [template]);

	const hasServers = !!servers && servers.length > 0;
	const targetEnvironmentId = environmentId ?? envId;
	const canDeploy = !!targetEnvironmentId && !isPending;

	const handleDeploy = async () => {
		if (!template || !targetEnvironmentId) return;
		const promise = mutateAsync({
			id: template.id,
			environmentId: targetEnvironmentId,
			serverId: serverId === "hanzo" ? undefined : serverId,
			baseUrl,
		});
		toast.promise(promise, {
			loading: "Setting up...",
			success: () => {
				onOpenChange(false);
				if (onDeployed) {
					onDeployed();
				} else if (pickerMode && projectId && envId) {
					router.push(`/dashboard/project/${projectId}/environment/${envId}`);
				}
				return `${template.name} template created successfully`;
			},
			error: () => `An error occurred deploying ${template.name} template`,
		});
	};

	return (
		<Dialog open={!!template} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Deploy {template?.name}</DialogTitle>
					<DialogDescription>
						{pickerMode
							? "Choose where to deploy this open-source app."
							: `This will create an application from the ${template?.name} template and add it to your project.`}
					</DialogDescription>
				</DialogHeader>

				{isError && <AlertBlock type="error">{error?.message}</AlertBlock>}

				<div className="flex flex-col gap-4">
					{pickerMode &&
						(isLoadingProjects ? (
							<p className="text-sm text-muted-foreground">
								Loading projects...
							</p>
						) : projects && projects.length > 0 ? (
							<>
								<div className="flex flex-col gap-2">
									<Label>Project</Label>
									<Select
										value={projectId}
										onValueChange={(value) => {
											setProjectId(value);
											const next = projects.find((p) => p.projectId === value);
											const defaultEnv =
												next?.environments.find((e) => e.isDefault) ??
												next?.environments[0];
											setEnvId(defaultEnv?.environmentId);
										}}
									>
										<SelectTrigger>
											<SelectValue placeholder="Select a project" />
										</SelectTrigger>
										<SelectContent>
											<SelectGroup>
												{projects.map((project) => (
													<SelectItem
														key={project.projectId}
														value={project.projectId}
													>
														{project.name}
													</SelectItem>
												))}
												<SelectLabel>Projects ({projects.length})</SelectLabel>
											</SelectGroup>
										</SelectContent>
									</Select>
								</div>

								<div className="flex flex-col gap-2">
									<Label>Environment</Label>
									<Select
										value={envId}
										onValueChange={setEnvId}
										disabled={!projectId}
									>
										<SelectTrigger>
											<SelectValue placeholder="Select an environment" />
										</SelectTrigger>
										<SelectContent>
											<SelectGroup>
												{environments.map((environment) => (
													<SelectItem
														key={environment.environmentId}
														value={environment.environmentId}
													>
														{environment.name}
													</SelectItem>
												))}
												<SelectLabel>
													Environments ({environments.length})
												</SelectLabel>
											</SelectGroup>
										</SelectContent>
									</Select>
								</div>
							</>
						) : (
							<div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-4">
								<p className="text-sm text-muted-foreground">
									You need a project before you can deploy. Create one to get
									started.
								</p>
								<HandleProject />
							</div>
						))}

					{hasServers && (
						<div className="flex flex-col gap-2">
							<TooltipProvider delayDuration={0}>
								<Tooltip>
									<TooltipTrigger asChild>
										<Label className="w-fit flex flex-row gap-1 items-center">
											Select a Server {!isCloud ? "(Optional)" : ""}
											<HelpCircle className="size-4 text-muted-foreground" />
										</Label>
									</TooltipTrigger>
									<TooltipContent
										className="z-[999] w-[300px]"
										align="start"
										side="top"
									>
										<span>
											If no server is selected, the application will be deployed
											on the server where the user is logged in.
										</span>
									</TooltipContent>
								</Tooltip>
							</TooltipProvider>

							<Select
								onValueChange={setServerId}
								defaultValue={!isCloud ? "hanzo" : undefined}
							>
								<SelectTrigger>
									<SelectValue
										placeholder={
											!isCloud ? "Hanzo Platform" : "Select a Server"
										}
									/>
								</SelectTrigger>
								<SelectContent>
									<SelectGroup>
										{!isCloud && (
											<SelectItem value="hanzo">
												<span className="flex items-center gap-2 justify-between w-full">
													<span>Hanzo Platform</span>
													<span className="text-muted-foreground text-xs self-center">
														Default
													</span>
												</span>
											</SelectItem>
										)}
										{servers?.map((server) => (
											<SelectItem key={server.serverId} value={server.serverId}>
												<span className="flex items-center gap-2 justify-between w-full">
													<span>{server.name}</span>
													<span className="text-muted-foreground text-xs self-center">
														{server.ipAddress}
													</span>
												</span>
											</SelectItem>
										))}
										<SelectLabel>
											Servers ({(servers?.length ?? 0) + (!isCloud ? 1 : 0)})
										</SelectLabel>
									</SelectGroup>
								</SelectContent>
							</Select>
						</div>
					)}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						disabled={!canDeploy}
						isLoading={isPending}
						onClick={handleDeploy}
					>
						Deploy
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
