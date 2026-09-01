import { Switch } from "@hanzo/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import {
	CheckCircle,
	ChevronDown,
	ChevronUp,
	Cloud,
	ExternalLink,
	Loader2,
	PlusIcon,
	Trash2,
	XCircle,
} from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
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
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/utils/api";

const PROVIDER_TYPES = [
	{ value: "cloudflare-pages", label: "Cloudflare Pages", icon: "☁️" },
	{ value: "vercel", label: "Vercel", icon: "▲" },
	{ value: "netlify", label: "Netlify", icon: "◆" },
	{ value: "aws-amplify", label: "AWS Amplify", icon: "⚡" },
	{ value: "github-pages", label: "GitHub Pages", icon: "🐙" },
	{ value: "custom", label: "Custom", icon: "🔧" },
] as const;

const PROVIDER_FIELDS: Record<
	string,
	Array<{
		key: string;
		label: string;
		placeholder: string;
		sensitive?: boolean;
	}>
> = {
	"cloudflare-pages": [
		{
			key: "apiToken",
			label: "API Token",
			placeholder: "CF API token with Pages permissions",
			sensitive: true,
		},
		{
			key: "accountId",
			label: "Account ID",
			placeholder: "Cloudflare account ID",
		},
	],
	vercel: [
		{
			key: "apiToken",
			label: "API Token",
			placeholder: "Vercel personal access token",
			sensitive: true,
		},
		{ key: "accountId", label: "Team ID (optional)", placeholder: "team_..." },
	],
	netlify: [
		{
			key: "apiToken",
			label: "Personal Access Token",
			placeholder: "Netlify PAT",
			sensitive: true,
		},
	],
	"aws-amplify": [
		{
			key: "apiToken",
			label: "Access Key ID",
			placeholder: "AKIA...",
			sensitive: true,
		},
		{
			key: "accountId",
			label: "Secret Access Key",
			placeholder: "Secret key",
			sensitive: true,
		},
	],
	"github-pages": [
		{
			key: "apiToken",
			label: "GitHub Token",
			placeholder: "ghp_...",
			sensitive: true,
		},
	],
	custom: [
		{
			key: "apiToken",
			label: "API Token",
			placeholder: "Provider API token",
			sensitive: true,
		},
		{
			key: "accountId",
			label: "Account/Team ID",
			placeholder: "Optional identifier",
		},
	],
};

const createSchema = z.object({
	name: z.string().min(1, "Name is required"),
	providerType: z.enum([
		"cloudflare-pages",
		"vercel",
		"netlify",
		"aws-amplify",
		"github-pages",
		"custom",
	]),
	apiToken: z.string().optional(),
	accountId: z.string().optional(),
	isDefault: z.boolean().optional(),
});

type CreateForm = z.infer<typeof createSchema>;

function getProviderLabel(type: string) {
	return PROVIDER_TYPES.find((p) => p.value === type)?.label ?? type;
}

function getProviderIcon(type: string) {
	return PROVIDER_TYPES.find((p) => p.value === type)?.icon ?? "🔌";
}

function CreateProviderDialog({ onSuccess }: { onSuccess: () => void }) {
	const [open, setOpen] = useState(false);
	const { mutateAsync, isPending } = api.deployProvider.create.useMutation();

	const form = useForm<CreateForm>({
		defaultValues: {
			name: "",
			providerType: "cloudflare-pages",
			apiToken: "",
			accountId: "",
			isDefault: true,
		},
		resolver: zodResolver(createSchema),
	});

	const providerType = form.watch("providerType");
	const fields = PROVIDER_FIELDS[providerType] ?? PROVIDER_FIELDS.custom;

	const onSubmit = async (data: CreateForm) => {
		await mutateAsync(data)
			.then(() => {
				toast.success("Deploy provider created");
				form.reset();
				setOpen(false);
				onSuccess();
			})
			.catch((err: Error) => {
				toast.error(err.message || "Failed to create deploy provider");
			});
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button>
					<PlusIcon className="h-4 w-4" />
					Add Provider
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Add Deploy Provider</DialogTitle>
					<DialogDescription>
						Connect a hosting provider for static site deployments
					</DialogDescription>
				</DialogHeader>
				<Form {...form}>
					<form
						id="hook-form-create-deploy-provider"
						onSubmit={form.handleSubmit(onSubmit)}
						className="grid w-full gap-4"
					>
						<FormField
							control={form.control}
							name="name"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Name</FormLabel>
									<FormControl>
										<Input placeholder="My Cloudflare Account" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="providerType"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Provider</FormLabel>
									<Select
										onValueChange={field.onChange}
										defaultValue={field.value}
									>
										<FormControl>
											<SelectTrigger>
												<SelectValue placeholder="Select provider" />
											</SelectTrigger>
										</FormControl>
										<SelectContent>
											{PROVIDER_TYPES.map((pt) => (
												<SelectItem key={pt.value} value={pt.value}>
													{pt.icon} {pt.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									<FormMessage />
								</FormItem>
							)}
						/>
						{fields?.map((f) => (
							<FormField
								key={f.key}
								control={form.control}
								name={f.key as "apiToken" | "accountId"}
								render={({ field }) => (
									<FormItem>
										<FormLabel>{f.label}</FormLabel>
										<FormControl>
											<Input
												type={f.sensitive ? "password" : "text"}
												placeholder={f.placeholder}
												{...field}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
						))}
						<FormField
							control={form.control}
							name="isDefault"
							render={({ field }) => (
								<FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
									<div className="space-y-0.5">
										<FormLabel>Default Provider</FormLabel>
										<FormDescription>
											Use this provider by default for{" "}
											{getProviderLabel(providerType)} deployments
										</FormDescription>
									</div>
									<FormControl>
										<Switch
											checked={field.value}
											onCheckedChange={field.onChange}
										/>
									</FormControl>
								</FormItem>
							)}
						/>
					</form>
					<DialogFooter>
						<Button
							isLoading={isPending}
							form="hook-form-create-deploy-provider"
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

interface ProviderData {
	deployProviderId: string;
	name: string;
	providerType: string;
	apiToken: string | null;
	accountId: string | null;
	isDefault: boolean;
	createdAt: string;
}

function ProviderCard({
	provider,
	onRefresh,
}: {
	provider: ProviderData;
	onRefresh: () => void;
}) {
	const [testResult, setTestResult] = useState<{
		success: boolean;
		message: string;
	} | null>(null);
	const { mutateAsync: testConn, isPending: isTesting } =
		api.deployProvider.testConnection.useMutation();
	const { mutateAsync: remove, isPending: isRemoving } =
		api.deployProvider.remove.useMutation();

	const handleTest = async () => {
		const result = await testConn({
			deployProviderId: provider.deployProviderId,
		}).catch((err: Error) => ({
			success: false,
			message: err.message || "Connection test failed",
		}));
		setTestResult(result);
	};

	const handleRemove = async () => {
		await remove({ deployProviderId: provider.deployProviderId })
			.then(() => {
				toast.success("Deploy provider removed");
				onRefresh();
			})
			.catch((err: Error) => {
				toast.error(err.message || "Failed to remove provider");
			});
	};

	const maskedToken = provider.apiToken
		? `...${provider.apiToken.slice(-6)}`
		: "not set";

	return (
		<Card className="bg-sidebar">
			<CardHeader className="pb-3">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<span className="text-lg">
							{getProviderIcon(provider.providerType)}
						</span>
						<div className="flex flex-col gap-0.5">
							<CardTitle className="text-base">{provider.name}</CardTitle>
							<CardDescription>
								{getProviderLabel(provider.providerType)}
							</CardDescription>
						</div>
					</div>
					<div className="flex items-center gap-2">
						{provider.isDefault && <Badge variant="green">Default</Badge>}
					</div>
				</div>
			</CardHeader>
			<CardContent className="space-y-3">
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<span>Token:</span>
					<code className="text-xs bg-muted px-1.5 py-0.5 rounded">
						{maskedToken}
					</code>
					{provider.accountId && (
						<>
							<span className="mx-1">|</span>
							<span>Account:</span>
							<code className="text-xs bg-muted px-1.5 py-0.5 rounded">
								{provider.accountId}
							</code>
						</>
					)}
				</div>

				{testResult && (
					<div
						className={`flex items-center gap-2 text-sm rounded-md border p-2 ${
							testResult.success
								? "border-green-500/30 bg-green-500/5 text-green-600"
								: "border-red-500/30 bg-red-500/5 text-red-600"
						}`}
					>
						{testResult.success ? (
							<CheckCircle className="size-4" />
						) : (
							<XCircle className="size-4" />
						)}
						{testResult.message}
					</div>
				)}

				<div className="flex items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						onClick={handleTest}
						isLoading={isTesting}
					>
						<Cloud className="h-4 w-4" />
						Test Connection
					</Button>
					<DialogAction
						title="Remove Provider"
						description={`Are you sure you want to remove "${provider.name}"? Any deployments using this provider will fall back to environment variables.`}
						type="destructive"
						onClick={handleRemove}
					>
						<Button
							variant="ghost"
							size="sm"
							className="group hover:bg-red-500/10"
							isLoading={isRemoving}
						>
							<Trash2 className="h-4 w-4 text-primary group-hover:text-red-500" />
							Remove
						</Button>
					</DialogAction>
				</div>
			</CardContent>
		</Card>
	);
}

export function ShowDeployProviders() {
	const {
		data: providers,
		isLoading,
		refetch,
	} = api.deployProvider.all.useQuery();

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
			<div className="flex items-center justify-between">
				<div>
					<h3 className="text-lg font-medium">Deploy Providers</h3>
					<p className="text-sm text-muted-foreground">
						Connect hosting providers for static site and Pages deployments.
						Each organization can configure its own credentials.
					</p>
				</div>
				<CreateProviderDialog onSuccess={() => refetch()} />
			</div>

			{!providers || providers.length === 0 ? (
				<div className="flex flex-col items-center gap-3 min-h-[25vh] justify-center">
					<Cloud className="size-8 text-muted-foreground" />
					<span className="text-base text-muted-foreground text-center">
						No deploy providers configured
					</span>
					<p className="text-sm text-muted-foreground text-center max-w-md">
						Add a provider to deploy static sites to Cloudflare Pages, Vercel,
						Netlify, or other hosting platforms directly from this dashboard.
					</p>
					<CreateProviderDialog onSuccess={() => refetch()} />
				</div>
			) : (
				<div className="grid gap-4 md:grid-cols-2">
					{(providers as unknown as ProviderData[]).map((provider) => (
						<ProviderCard
							key={provider.deployProviderId}
							provider={provider}
							onRefresh={() => refetch()}
						/>
					))}
				</div>
			)}
		</div>
	);
}
