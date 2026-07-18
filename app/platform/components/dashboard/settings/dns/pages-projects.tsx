import { zodResolver } from "@hookform/resolvers/zod";
import {
	ChevronDown,
	ChevronUp,
	ExternalLink,
	Globe,
	Loader2,
	PlusIcon,
	RefreshCw,
	Rocket,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { AlertBlock } from "@/components/shared/alert-block";
import { DialogAction } from "@/components/shared/dialog-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { dns } from "@/utils/zap-dns";

const createProjectSchema = z.object({
	name: z
		.string()
		.min(1, "Project name is required")
		.regex(
			/^[a-z0-9-]+$/,
			"Only lowercase letters, numbers, and hyphens allowed",
		),
	productionBranch: z.string().min(1, "Production branch is required"),
});

type CreateProjectForm = z.infer<typeof createProjectSchema>;

const addDomainSchema = z.object({
	domain: z.string().min(1, "Domain is required"),
});

type AddDomainForm = z.infer<typeof addDomainSchema>;

function getDeploymentStatusVariant(
	status: string | undefined,
): "green" | "red" | "yellow" | "blue" | "blank" {
	switch (status) {
		case "active":
		case "success":
			return "green";
		case "failure":
			return "red";
		case "idle":
		case "queued":
			return "yellow";
		case "building":
			return "blue";
		default:
			return "blank";
	}
}

function CreateProjectDialog({ onSuccess }: { onSuccess: () => void }) {
	const [open, setOpen] = useState(false);
	const { mutateAsync, isPending } = dns.createPagesProject.useMutation();

	const form = useForm<CreateProjectForm>({
		defaultValues: {
			name: "",
			productionBranch: "main",
		},
		resolver: zodResolver(createProjectSchema),
	});

	const onSubmit = async (data: CreateProjectForm) => {
		await mutateAsync({
			name: data.name,
			production_branch: data.productionBranch,
		})
			.then(() => {
				toast.success("Pages project created");
				form.reset();
				setOpen(false);
				onSuccess();
			})
			.catch((err: Error) => {
				toast.error(err.message || "Failed to create Pages project");
			});
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button>
					<PlusIcon className="h-4 w-4" />
					Create Project
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Create Pages Project</DialogTitle>
					<DialogDescription>
						Create a new Cloudflare Pages project
					</DialogDescription>
				</DialogHeader>
				<Form {...form}>
					<form
						id="hook-form-create-pages-project"
						onSubmit={form.handleSubmit(onSubmit)}
						className="grid w-full gap-4"
					>
						<FormField
							control={form.control}
							name="name"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Project Name</FormLabel>
									<FormControl>
										<Input placeholder="my-project" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="productionBranch"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Production Branch</FormLabel>
									<FormControl>
										<Input placeholder="main" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
					</form>
					<DialogFooter>
						<Button
							isLoading={isPending}
							form="hook-form-create-pages-project"
							type="submit"
						>
							Create
						</Button>
					</DialogFooter>
				</Form>
			</DialogContent>
		</Dialog>
	);
}

function AddDomainDialog({
	projectName,
	onSuccess,
}: {
	projectName: string;
	onSuccess: () => void;
}) {
	const [open, setOpen] = useState(false);
	const { mutateAsync, isPending } = dns.addPagesDomain.useMutation();

	const form = useForm<AddDomainForm>({
		defaultValues: {
			domain: "",
		},
		resolver: zodResolver(addDomainSchema),
	});

	const onSubmit = async (data: AddDomainForm) => {
		await mutateAsync({
			projectName,
			domain: data.domain,
		})
			.then(() => {
				toast.success("Custom domain added");
				form.reset();
				setOpen(false);
				onSuccess();
			})
			.catch((err: Error) => {
				toast.error(err.message || "Failed to add custom domain");
			});
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button variant="outline" size="sm">
					<Globe className="h-4 w-4" />
					Add Domain
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Add Custom Domain</DialogTitle>
					<DialogDescription>
						Add a custom domain to {projectName}
					</DialogDescription>
				</DialogHeader>
				<Form {...form}>
					<form
						id={`hook-form-add-domain-${projectName}`}
						onSubmit={form.handleSubmit(onSubmit)}
						className="grid w-full gap-4"
					>
						<FormField
							control={form.control}
							name="domain"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Domain</FormLabel>
									<FormControl>
										<Input placeholder="app.example.com" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
					</form>
					<DialogFooter>
						<Button
							isLoading={isPending}
							form={`hook-form-add-domain-${projectName}`}
							type="submit"
						>
							Add
						</Button>
					</DialogFooter>
				</Form>
			</DialogContent>
		</Dialog>
	);
}

interface PagesProject {
	name: string;
	subdomain: string;
	production_branch?: string;
	latest_deployment?: {
		id: string;
		environment: string;
		latest_stage?: {
			name: string;
			status: string;
		};
	};
	domains?: Array<{ id: string; name: string; status?: string }>;
}

function ProjectCard({
	project,
	onRefresh,
}: {
	project: PagesProject;
	onRefresh: () => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const { mutateAsync: triggerDeploy, isPending: isDeploying } =
		dns.triggerPagesDeploy.useMutation();
	const { mutateAsync: removeDomain, isPending: isRemovingDomain } =
		dns.removePagesDomain.useMutation();

	const latestStatus =
		project.latest_deployment?.latest_stage?.status ?? "unknown";

	const handleDeploy = async () => {
		await triggerDeploy({ projectName: project.name })
			.then(() => {
				toast.success(`Deployment triggered for ${project.name}`);
				onRefresh();
			})
			.catch((err: Error) => {
				toast.error(err.message || "Failed to trigger deployment");
			});
	};

	const handleRemoveDomain = async (domainId: string, domainName: string) => {
		await removeDomain({ projectName: project.name, domainId })
			.then(() => {
				toast.success(`Domain ${domainName} removed`);
				onRefresh();
			})
			.catch((err: Error) => {
				toast.error(err.message || "Failed to remove domain");
			});
	};

	const domains = project.domains ?? [];

	return (
		<Card className="bg-sidebar">
			<CardHeader className="pb-3">
				<div className="flex items-center justify-between">
					<div className="flex flex-col gap-1">
						<CardTitle className="text-base">{project.name}</CardTitle>
						<CardDescription className="flex items-center gap-2">
							<a
								href={`https://${project.subdomain}`}
								target="_blank"
								rel="noopener noreferrer"
								className="flex items-center gap-1 hover:underline"
							>
								{project.subdomain}
								<ExternalLink className="size-3" />
							</a>
						</CardDescription>
					</div>
					<Badge variant={getDeploymentStatusVariant(latestStatus)}>
						{latestStatus}
					</Badge>
				</div>
			</CardHeader>
			<CardContent className="space-y-3">
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<span>Branch:</span>
					<Badge variant="blank">{project.production_branch ?? "main"}</Badge>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						onClick={handleDeploy}
						isLoading={isDeploying}
					>
						<Rocket className="h-4 w-4" />
						Deploy
					</Button>
					<AddDomainDialog
						projectName={project.name}
						onSuccess={onRefresh}
					/>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => setExpanded(!expanded)}
					>
						{expanded ? (
							<ChevronUp className="h-4 w-4" />
						) : (
							<ChevronDown className="h-4 w-4" />
						)}
						{domains.length} {domains.length === 1 ? "domain" : "domains"}
					</Button>
				</div>

				{expanded && domains.length > 0 && (
					<div className="rounded-md border bg-background p-3 space-y-2">
						{domains.map(
							(domain: { id: string; name: string; status?: string }) => (
								<div
									key={domain.id}
									className="flex items-center justify-between"
								>
									<div className="flex items-center gap-2">
										<Globe className="size-3 text-muted-foreground" />
										<span className="text-sm font-mono">{domain.name}</span>
										{domain.status && (
											<Badge
												variant={
													domain.status === "active" ? "green" : "yellow"
												}
											>
												{domain.status}
											</Badge>
										)}
									</div>
									<DialogAction
										title="Remove Domain"
										description={`Are you sure you want to remove ${domain.name} from ${project.name}?`}
										type="destructive"
										onClick={() =>
											handleRemoveDomain(domain.id, domain.name)
										}
									>
										<Button
											variant="ghost"
											size="icon"
											className="group hover:bg-red-500/10 h-11 w-11"
											isLoading={isRemovingDomain}
										>
											<Trash2 className="size-3 text-primary group-hover:text-red-500" />
										</Button>
									</DialogAction>
								</div>
							),
						)}
					</div>
				)}
				{expanded && domains.length === 0 && (
					<div className="rounded-md border bg-background p-3">
						<span className="text-sm text-muted-foreground">
							No custom domains configured
						</span>
					</div>
				)}
			</CardContent>
		</Card>
	);
}

export function PagesProjects() {
	const {
		data: projects,
		isLoading,
		isError,
		error: projectsErr,
		refetch,
	} = dns.listPagesProjects.useQuery();

	if (isLoading) {
		return (
			<div className="space-y-4">
				<div className="flex justify-end">
					<Skeleton className="h-10 w-36" />
				</div>
				<div className="grid gap-4 md:grid-cols-2">
					<Skeleton className="h-48" />
					<Skeleton className="h-48" />
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<div className="flex justify-end">
				<CreateProjectDialog onSuccess={() => refetch()} />
			</div>

			{isError ? (
				<div className="flex flex-col items-center gap-3 min-h-[25vh] justify-center">
					<AlertBlock type="error">
						{projectsErr?.message || "Failed to load Pages projects."}
					</AlertBlock>
					<Button variant="outline" onClick={() => refetch()}>
						<RefreshCw className="size-4" /> Retry
					</Button>
				</div>
			) : !projects || projects.length === 0 ? (
				<div className="flex flex-col items-center gap-3 min-h-[25vh] justify-center">
					<Rocket className="size-8 text-muted-foreground" />
					<span className="text-base text-muted-foreground text-center">
						No Pages projects found
					</span>
					<CreateProjectDialog onSuccess={() => refetch()} />
				</div>
			) : (
				<div className="grid gap-4 md:grid-cols-2">
					{(projects as unknown as PagesProject[]).map((project) => (
						<ProjectCard
							key={project.name}
							project={project}
							onRefresh={() => refetch()}
						/>
					))}
				</div>
			)}
		</div>
	);
}
