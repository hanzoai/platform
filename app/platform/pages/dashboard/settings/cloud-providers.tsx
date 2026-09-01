/**
 * Cloud Providers Settings Page
 *
 * Admin page for managing cloud provider integrations (DigitalOcean, etc.).
 * Lists configured providers, allows adding new providers, and displays
 * compute pools with scaling controls.
 */

import { IS_CLOUD, validateRequest } from "@hanzo/platform";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@hanzo/ui";
import { createServerSideHelpers } from "@trpc/react-query/server";
import {
	AlertCircle,
	CheckCircle,
	Cloud,
	Layers,
	Loader2,
	Plus,
	Server,
	Settings2,
} from "lucide-react";
import type { GetServerSidePropsContext } from "next";
import type { ReactElement } from "react";
import { useState } from "react";
import superjson from "superjson";
import { CloudProviderSettings } from "@/components/dashboard/cloud-provider/CloudProviderSettings";
import { ComputePoolCard } from "@/components/dashboard/cloud-provider/ComputePoolCard";
import { NodeStatusMonitor } from "@/components/dashboard/cloud-provider/NodeStatusMonitor";
import { DashboardLayout } from "@/components/layouts/dashboard-layout";
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
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";
import { appRouter } from "@/server/api/root";
import { api } from "@/utils/api";
import { getLocale, serverSideTranslations } from "@/utils/i18n";
import { digitalocean } from "@/utils/zap-digitalocean";

// ============================================================================
// Page Component
// ============================================================================

// Shape of a cloud provider row returned by the ZAP `digitalocean` capability.
// The ZAP client surfaces results as the untyped Result carrier, so we name the
// fields the page actually reads here rather than casting to `any`.
interface CloudProvider {
	providerId: string;
	name: string;
	slug: string;
	providerType: string;
	defaultRegion: string;
	isActive: boolean;
	lastValidated: Date | null;
	validationError: string | null;
	createdAt: Date;
}

const CloudProvidersPage = () => {
	const [configSheetOpen, setConfigSheetOpen] = useState(false);
	const [selectedProviderId, setSelectedProviderId] = useState<string | null>(
		null,
	);
	const [activePoolId, setActivePoolId] = useState<string | null>(null);

	// Fetch providers
	const { data: providers, isLoading: isLoadingProviders } =
		digitalocean.listProviders.useQuery() as {
			data: CloudProvider[] | undefined;
			isLoading: boolean;
		};

	// Determine if we have any providers
	const hasProviders = providers && providers.length > 0;
	const activeProvider = providers?.find((p) => p.isActive);

	const handleAddProvider = () => {
		setSelectedProviderId(null);
		setConfigSheetOpen(true);
	};

	const handleEditProvider = (providerId: string) => {
		setSelectedProviderId(providerId);
		setConfigSheetOpen(true);
	};

	return (
		<div className="w-full">
			<div className="h-full max-w-6xl mx-auto flex flex-col gap-6">
				{/* Header */}
				<div className="flex items-center justify-between">
					<div>
						<h1 className="text-2xl font-bold flex items-center gap-2">
							<Cloud className="h-6 w-6" />
							Cloud Providers
						</h1>
						<p className="text-muted-foreground mt-1">
							Manage cloud infrastructure for automatic scaling
						</p>
					</div>
					<Sheet open={configSheetOpen} onOpenChange={setConfigSheetOpen}>
						<SheetTrigger asChild>
							<Button onClick={handleAddProvider}>
								<Plus className="h-4 w-4 mr-2" />
								Add Provider
							</Button>
						</SheetTrigger>
						<SheetContent className="sm:max-w-lg overflow-y-auto">
							<SheetHeader>
								<SheetTitle>
									{selectedProviderId ? "Edit Provider" : "Add Cloud Provider"}
								</SheetTitle>
								<SheetDescription>
									Configure your cloud provider credentials and settings
								</SheetDescription>
							</SheetHeader>
							<div className="mt-6">
								<CloudProviderSettings
									providerId={selectedProviderId || undefined}
									onSuccess={() => setConfigSheetOpen(false)}
								/>
							</div>
						</SheetContent>
					</Sheet>
				</div>

				{/* Loading State */}
				{isLoadingProviders && (
					<Card className="bg-sidebar">
						<CardContent className="flex items-center justify-center py-12">
							<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
						</CardContent>
					</Card>
				)}

				{/* No Providers State */}
				{!isLoadingProviders && !hasProviders && (
					<Card className="bg-sidebar">
						<CardContent className="flex flex-col items-center justify-center py-12 text-center">
							<div className="p-4 rounded-full bg-muted mb-4">
								<Cloud className="h-8 w-8 text-muted-foreground" />
							</div>
							<h3 className="text-lg font-semibold">No Cloud Providers</h3>
							<p className="text-muted-foreground mt-1 max-w-sm">
								Connect a cloud provider to enable automatic provisioning and
								scaling of compute nodes.
							</p>
							<Button onClick={handleAddProvider} className="mt-4">
								<Plus className="h-4 w-4 mr-2" />
								Add DigitalOcean Provider
							</Button>
						</CardContent>
					</Card>
				)}

				{/* Providers List */}
				{!isLoadingProviders && hasProviders && (
					<Tabs defaultValue="providers" className="w-full">
						<TabsList>
							<TabsTrigger
								value="providers"
								className="flex items-center gap-2"
							>
								<Settings2 className="h-4 w-4" />
								Providers
							</TabsTrigger>
							<TabsTrigger value="pools" className="flex items-center gap-2">
								<Layers className="h-4 w-4" />
								Compute Pools
							</TabsTrigger>
							{activePoolId && (
								<TabsTrigger value="nodes" className="flex items-center gap-2">
									<Server className="h-4 w-4" />
									Nodes
								</TabsTrigger>
							)}
						</TabsList>

						{/* Providers Tab */}
						<TabsContent value="providers" className="mt-6">
							<div className="grid gap-4">
								{providers?.map((provider) => (
									<ProviderCard
										key={provider.providerId}
										provider={provider}
										onEdit={() => handleEditProvider(provider.providerId)}
									/>
								))}
							</div>
						</TabsContent>

						{/* Pools Tab */}
						<TabsContent value="pools" className="mt-6">
							{activeProvider ? (
								<PoolsSection
									providerId={activeProvider.providerId}
									onPoolSelect={(poolId) => setActivePoolId(poolId)}
								/>
							) : (
								<Card className="bg-sidebar">
									<CardContent className="py-8 text-center">
										<AlertCircle className="h-8 w-8 text-yellow-500 mx-auto mb-2" />
										<p className="text-muted-foreground">
											No active provider. Enable a provider to manage compute
											pools.
										</p>
									</CardContent>
								</Card>
							)}
						</TabsContent>

						{/* Nodes Tab */}
						{activePoolId && (
							<TabsContent value="nodes" className="mt-6">
								<Card className="bg-sidebar p-4">
									<NodeStatusMonitor poolId={activePoolId} />
								</Card>
							</TabsContent>
						)}
					</Tabs>
				)}
			</div>
		</div>
	);
};

// ============================================================================
// Provider Card Component
// ============================================================================

interface ProviderCardProps {
	provider: {
		providerId: string;
		name: string;
		slug: string;
		providerType: string;
		isActive: boolean;
		defaultRegion: string;
		lastValidated: Date | null;
		validationError: string | null;
		createdAt: Date;
	};
	onEdit: () => void;
}

function ProviderCard({ provider, onEdit }: ProviderCardProps) {
	const providerLogos: Record<string, string> = {
		digitalocean: "/images/digitalocean-logo.svg",
		aws: "/images/aws-logo.svg",
		gcp: "/images/gcp-logo.svg",
	};

	return (
		<Card className="bg-sidebar">
			<CardHeader className="pb-3">
				<div className="flex items-start justify-between">
					<div className="flex items-center gap-3">
						<div className="p-2 rounded-lg bg-primary/10">
							<Cloud className="h-5 w-5 text-primary" />
						</div>
						<div>
							<CardTitle className="text-lg">{provider.name}</CardTitle>
							<CardDescription>
								{provider.providerType} | {provider.slug}
							</CardDescription>
						</div>
					</div>
					<div className="flex items-center gap-2">
						{provider.isActive ? (
							<Badge variant="green" className="flex items-center gap-1">
								<CheckCircle className="h-3 w-3" />
								Active
							</Badge>
						) : (
							<Badge variant="yellow">Disabled</Badge>
						)}
						<Button variant="outline" size="sm" onClick={onEdit}>
							<Settings2 className="h-4 w-4 mr-1" />
							Configure
						</Button>
					</div>
				</div>
			</CardHeader>
			<CardContent>
				<div className="grid grid-cols-3 gap-4 text-sm">
					<div>
						<span className="text-muted-foreground">Default Region</span>
						<p className="font-medium">{provider.defaultRegion}</p>
					</div>
					<div>
						<span className="text-muted-foreground">Last Validated</span>
						<p className="font-medium">
							{provider.lastValidated
								? new Date(provider.lastValidated).toLocaleDateString()
								: "Never"}
						</p>
					</div>
					<div>
						<span className="text-muted-foreground">Created</span>
						<p className="font-medium">
							{new Date(provider.createdAt).toLocaleDateString()}
						</p>
					</div>
				</div>
				{provider.validationError && (
					<div className="mt-3 p-2 rounded bg-red-500/10 text-red-500 text-sm flex items-center gap-2">
						<AlertCircle className="h-4 w-4" />
						{provider.validationError}
					</div>
				)}
			</CardContent>
		</Card>
	);
}

// ============================================================================
// Pools Section Component
// ============================================================================

interface PoolsSectionProps {
	providerId: string;
	onPoolSelect: (poolId: string) => void;
}

function PoolsSection({ providerId, onPoolSelect }: PoolsSectionProps) {
	// For now, we'll mock pool data since we need to add a pools query
	// In production, this would come from api.computePool.list or similar
	const mockPools = [
		{
			poolId: "pool-1",
			name: "Production Workers",
			slug: "prod-workers",
			description: "Main production compute pool",
			status: "active" as const,
			primaryRegion: "nyc1",
			regions: ["nyc1", "sfo3"],
			totalCpuCores: 32,
			totalMemoryMb: 65536,
			totalStorageGb: 640,
			totalGpuCount: 0,
			availableCpuCores: 16,
			availableMemoryMb: 32768,
			availableStorageGb: 320,
			availableGpuCount: 0,
			totalNodes: 4,
			activeNodes: 4,
		},
	];

	// Check if we have actual pools from the API
	// const { data: pools, isLoading } = api.computePool.list.useQuery();

	return (
		<div className="space-y-4">
			{mockPools.length === 0 ? (
				<Card className="bg-sidebar">
					<CardContent className="py-8 text-center">
						<Layers className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
						<h3 className="font-medium">No Compute Pools</h3>
						<p className="text-sm text-muted-foreground mt-1">
							Create a compute pool to organize your nodes
						</p>
						<Button className="mt-4" variant="outline">
							<Plus className="h-4 w-4 mr-2" />
							Create Pool
						</Button>
					</CardContent>
				</Card>
			) : (
				<div className="grid gap-4 md:grid-cols-2">
					{mockPools.map((pool) => (
						<div
							key={pool.poolId}
							onClick={() => onPoolSelect(pool.poolId)}
							className="cursor-pointer"
						>
							<ComputePoolCard
								pool={pool}
								providerId={providerId}
								onScaleStart={() => onPoolSelect(pool.poolId)}
							/>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

// ============================================================================
// Page Layout & SSR
// ============================================================================

export default CloudProvidersPage;

CloudProvidersPage.getLayout = (page: ReactElement) => {
	return <DashboardLayout metaName="Cloud Providers">{page}</DashboardLayout>;
};

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
	const { req, res } = ctx;
	const locale = await getLocale(req.cookies);

	// Redirect to projects if cloud mode (providers managed externally)
	if (IS_CLOUD) {
		return {
			redirect: {
				permanent: false,
				destination: "/dashboard/projects",
			},
		};
	}

	// Validate auth
	const { user, session } = await validateRequest(ctx.req);
	if (!user) {
		return {
			redirect: {
				permanent: false,
				destination: "/",
			},
		};
	}

	// Only admins can access this page
	if (user.role === "member") {
		return {
			redirect: {
				permanent: false,
				destination: "/dashboard/settings/profile",
			},
		};
	}

	// Prefetch data
	const helpers = createServerSideHelpers({
		router: appRouter,
		ctx: {
			req: req as any,
			res: res as any,
			db: null as any,
			session: session as any,
			user: user as any,
		},
		transformer: superjson,
	});

	// digitalocean.* moved to the native ZAP `digitalocean` capability
	// (utils/zap-digitalocean); provider data is fetched client-side via the
	// zap hooks, so there is no tRPC prefetch here.

	return {
		props: {
			trpcState: helpers.dehydrate(),
			...(await serverSideTranslations(locale, ["settings"])),
		},
	};
}
