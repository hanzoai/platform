/**
 * CloudProviderSettings
 *
 * Form component for configuring and managing DigitalOcean cloud provider credentials.
 * Validates API token on save and displays current provider status.
 */

import { useState } from "react";
import { useForm } from "react-hook-form";
import { standardSchemaResolver as zodResolver } from "@hookform/resolvers/standard-schema";
import { z } from "zod";
import { Cloud, CheckCircle, XCircle, Loader2, Eye, EyeOff, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Form,
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { api } from "@/utils/api";

// ============================================================================
// Schema
// ============================================================================

const configureProviderSchema = z.object({
	name: z.string().min(1, "Name is required").max(100),
	slug: z
		.string()
		.min(1, "Slug is required")
		.max(100)
		.regex(/^[a-z0-9-]+$/, "Slug must contain only lowercase letters, numbers, and hyphens"),
	apiToken: z.string().min(1, "API token is required"),
	defaultRegion: z.string().min(1, "Region is required"),
});

const updateProviderSchema = z.object({
	name: z.string().min(1).max(100).optional(),
	defaultRegion: z.string().optional(),
	defaultSize: z.string().optional(),
	isActive: z.boolean().optional(),
	apiToken: z.string().optional(),
});

type ConfigureProviderInput = z.infer<typeof configureProviderSchema>;

// ============================================================================
// Component
// ============================================================================

interface CloudProviderSettingsProps {
	providerId?: string;
	onSuccess?: () => void;
}

export function CloudProviderSettings({ providerId, onSuccess }: CloudProviderSettingsProps) {
	const [showToken, setShowToken] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);

	const utils = api.useUtils();

	// Fetch existing provider if editing
	const { data: provider, isLoading: isLoadingProvider } = api.digitalocean.getProvider.useQuery(
		{ providerId: providerId! },
		{ enabled: !!providerId }
	);

	// Fetch available regions
	const { data: regions } = api.digitalocean.listRegions.useQuery(
		{ providerId: providerId! },
		{ enabled: !!providerId }
	);

	// Configure mutation
	const configureMutation = api.digitalocean.configureProvider.useMutation({
		onSuccess: () => {
			toast.success("Cloud provider configured successfully");
			utils.digitalocean.listProviders.invalidate();
			onSuccess?.();
		},
		onError: (error) => {
			toast.error(`Failed to configure provider: ${error.message}`);
		},
	});

	// Update mutation
	const updateMutation = api.digitalocean.updateProvider.useMutation({
		onSuccess: () => {
			toast.success("Provider updated successfully");
			utils.digitalocean.listProviders.invalidate();
			utils.digitalocean.getProvider.invalidate({ providerId });
		},
		onError: (error) => {
			toast.error(`Failed to update provider: ${error.message}`);
		},
	});

	// Delete mutation
	const deleteMutation = api.digitalocean.deleteProvider.useMutation({
		onSuccess: () => {
			toast.success("Provider deleted successfully");
			utils.digitalocean.listProviders.invalidate();
			onSuccess?.();
		},
		onError: (error) => {
			toast.error(`Failed to delete provider: ${error.message}`);
		},
	});

	const form = useForm<ConfigureProviderInput>({
		resolver: zodResolver(configureProviderSchema),
		defaultValues: {
			name: provider?.name || "",
			slug: provider?.slug || "",
			apiToken: "",
			defaultRegion: provider?.defaultRegion || "nyc1",
		},
	});

	async function onSubmit(values: ConfigureProviderInput) {
		setIsSubmitting(true);
		try {
			if (providerId) {
				await updateMutation.mutateAsync({
					providerId,
					name: values.name,
					defaultRegion: values.defaultRegion,
					apiToken: values.apiToken || undefined,
				});
			} else {
				await configureMutation.mutateAsync({
					name: values.name,
					slug: values.slug,
					apiToken: values.apiToken,
					defaultRegion: values.defaultRegion,
					providerType: "digitalocean",
				});
			}
		} finally {
			setIsSubmitting(false);
		}
	}

	if (isLoadingProvider && providerId) {
		return (
			<Card className="bg-sidebar">
				<CardContent className="flex items-center justify-center py-8">
					<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
				</CardContent>
			</Card>
		);
	}

	return (
		<Card className="bg-sidebar">
			<CardHeader>
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<Cloud className="h-5 w-5 text-muted-foreground" />
						<CardTitle className="text-xl">
							{providerId ? "Edit Cloud Provider" : "Configure DigitalOcean"}
						</CardTitle>
					</div>
					{provider && (
						<div className="flex items-center gap-2">
							<ProviderStatusBadge
								isActive={provider.isActive}
								lastValidated={provider.lastValidated}
								validationError={provider.validationError}
							/>
						</div>
					)}
				</div>
				<CardDescription>
					{providerId
						? "Update your DigitalOcean provider configuration"
						: "Connect your DigitalOcean account to provision and scale compute nodes"}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Form {...form}>
					<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
						<div className="grid gap-4 md:grid-cols-2">
							<FormField
								control={form.control}
								name="name"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Provider Name</FormLabel>
										<FormControl>
											<Input placeholder="My DigitalOcean Account" {...field} />
										</FormControl>
										<FormDescription>
											A friendly name to identify this provider
										</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>

							<FormField
								control={form.control}
								name="slug"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Slug</FormLabel>
										<FormControl>
											<Input
												placeholder="my-do-account"
												{...field}
												disabled={!!providerId}
											/>
										</FormControl>
										<FormDescription>
											Unique identifier (cannot be changed after creation)
										</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>
						</div>

						<FormField
							control={form.control}
							name="apiToken"
							render={({ field }) => (
								<FormItem>
									<FormLabel>
										API Token {providerId && "(leave blank to keep existing)"}
									</FormLabel>
									<FormControl>
										<div className="relative">
											<Input
												type={showToken ? "text" : "password"}
												placeholder={providerId ? "Enter new token to update" : "dop_v1_..."}
												{...field}
											/>
											<Button
												type="button"
												variant="ghost"
												size="sm"
												className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
												onClick={() => setShowToken(!showToken)}
											>
												{showToken ? (
													<EyeOff className="h-4 w-4 text-muted-foreground" />
												) : (
													<Eye className="h-4 w-4 text-muted-foreground" />
												)}
											</Button>
										</div>
									</FormControl>
									<FormDescription>
										Generate a token at{" "}
										<a
											href="https://cloud.digitalocean.com/account/api/tokens"
											target="_blank"
											rel="noopener noreferrer"
											className="text-primary underline"
										>
											DigitalOcean API Settings
										</a>
									</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>

						<FormField
							control={form.control}
							name="defaultRegion"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Default Region</FormLabel>
									<Select onValueChange={field.onChange} defaultValue={field.value}>
										<FormControl>
											<SelectTrigger>
												<SelectValue placeholder="Select a region" />
											</SelectTrigger>
										</FormControl>
										<SelectContent>
											{(regions || DEFAULT_REGIONS).map((region) => (
												<SelectItem
													key={typeof region === "string" ? region : region.slug}
													value={typeof region === "string" ? region : region.slug}
												>
													{typeof region === "string"
														? region
														: `${region.name} (${region.slug})`}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									<FormDescription>
										Default region for new instances
									</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>

						<div className="flex items-center justify-between pt-4 border-t">
							<div className="flex gap-2">
								{providerId && (
									<AlertDialog>
										<AlertDialogTrigger asChild>
											<Button type="button" variant="destructive" size="sm">
												<Trash2 className="h-4 w-4 mr-2" />
												Delete Provider
											</Button>
										</AlertDialogTrigger>
										<AlertDialogContent>
											<AlertDialogHeader>
												<AlertDialogTitle>Delete Cloud Provider?</AlertDialogTitle>
												<AlertDialogDescription>
													This will remove the provider configuration. Any existing
													instances will not be deleted from the cloud provider, but you
													will not be able to manage them from Platform.
												</AlertDialogDescription>
											</AlertDialogHeader>
											<AlertDialogFooter>
												<AlertDialogCancel>Cancel</AlertDialogCancel>
												<AlertDialogAction
													onClick={() => deleteMutation.mutate({ providerId })}
													className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
												>
													Delete
												</AlertDialogAction>
											</AlertDialogFooter>
										</AlertDialogContent>
									</AlertDialog>
								)}
							</div>

							<Button type="submit" disabled={isSubmitting}>
								{isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
								{providerId ? "Update Provider" : "Configure Provider"}
							</Button>
						</div>
					</form>
				</Form>
			</CardContent>
		</Card>
	);
}

// ============================================================================
// Helper Components
// ============================================================================

interface ProviderStatusBadgeProps {
	isActive: boolean;
	lastValidated: Date | null;
	validationError: string | null;
}

function ProviderStatusBadge({
	isActive,
	lastValidated,
	validationError,
}: ProviderStatusBadgeProps) {
	if (validationError) {
		return (
			<Badge variant="red" className="flex items-center gap-1">
				<XCircle className="h-3 w-3" />
				Invalid
			</Badge>
		);
	}

	if (!isActive) {
		return (
			<Badge variant="yellow" className="flex items-center gap-1">
				Disabled
			</Badge>
		);
	}

	return (
		<Badge variant="green" className="flex items-center gap-1">
			<CheckCircle className="h-3 w-3" />
			Active
		</Badge>
	);
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_REGIONS = [
	{ slug: "nyc1", name: "New York 1" },
	{ slug: "nyc3", name: "New York 3" },
	{ slug: "sfo3", name: "San Francisco 3" },
	{ slug: "ams3", name: "Amsterdam 3" },
	{ slug: "sgp1", name: "Singapore 1" },
	{ slug: "lon1", name: "London 1" },
	{ slug: "fra1", name: "Frankfurt 1" },
	{ slug: "tor1", name: "Toronto 1" },
	{ slug: "blr1", name: "Bangalore 1" },
	{ slug: "syd1", name: "Sydney 1" },
];
