import { Label } from "@hanzo/ui";
import {
	ChevronDown,
	ChevronUp,
	Download,
	Layers,
	Loader2,
	MoreHorizontal,
	PlusIcon,
	Rocket,
	Shield,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DialogAction } from "@/components/shared/dialog-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { api } from "@/utils/api";
import { doks } from "@/utils/zap";

const STATUS_VARIANTS: Record<
	string,
	"default" | "secondary" | "destructive" | "outline"
> = {
	running: "default",
	provisioning: "secondary",
	pending: "secondary",
	error: "destructive",
	deleting: "outline",
	deleted: "outline",
};

const PHASE_VARIANTS: Record<
	string,
	"default" | "secondary" | "destructive" | "outline"
> = {
	requested: "secondary",
	provisioning: "secondary",
	installing: "secondary",
	ready: "default",
	error: "destructive",
};

const PHASE_LABELS: Record<string, string> = {
	requested: "Baseline pending",
	provisioning: "Provisioning",
	installing: "Installing baseline",
	ready: "Ready",
	error: "Error",
};

interface ClusterCardProps {
	cluster: any;
	onUpdate: () => void;
}

export const ClusterCard = ({ cluster, onUpdate }: ClusterCardProps) => {
	const [expanded, setExpanded] = useState(false);
	const [addPoolOpen, setAddPoolOpen] = useState(false);
	const [editPoolOpen, setEditPoolOpen] = useState(false);
	const [editingPool, setEditingPool] = useState<any>(null);

	// Add node pool form state
	const [poolName, setPoolName] = useState("");
	const [poolSize, setPoolSize] = useState("s-2vcpu-4gb");
	const [poolCount, setPoolCount] = useState(2);

	// Edit node pool form state
	const [editPoolCount, setEditPoolCount] = useState(2);
	const [editPoolSize, setEditPoolSize] = useState("");

	// A bring-your-own (external) cluster has no DigitalOcean cluster behind it.
	// DO-only affordances (cost, kubeconfig download, HA, node-pool management)
	// don't apply; its lifecycle is attach → install baseline → select.
	const isExternal = !cluster.doClusterId;

	const { data: cost } = doks.clusterCost.useQuery(
		{ doksClusterId: cluster.doksClusterId },
		{ enabled: !!cluster.doksClusterId && !isExternal },
	);

	const { data: nodeSizes } = doks.listNodeSizes.useQuery(undefined, {
		enabled: addPoolOpen || editPoolOpen,
	});

	const { mutateAsync: deleteCluster, isPending: deleting } =
		doks.delete.useMutation();
	const { mutateAsync: upgradeToHA, isPending: upgrading } =
		doks.upgradeToHA.useMutation();

	// Dedicated-cluster lifecycle (org-scoped, tRPC): install the operator +
	// per-tenant baseline, and select/clear this cluster as the org's deploy
	// target. These complete a cluster from "exists" to "deployable + active".
	const { mutateAsync: installBaseline, isPending: installingBaseline } =
		api.dedicatedCluster.installBaseline.useMutation();
	const { mutateAsync: selectTarget, isPending: selecting } =
		api.dedicatedCluster.select.useMutation();
	const { mutateAsync: addNodePool, isPending: addingPool } =
		doks.addNodePool.useMutation();
	const { mutateAsync: updateNodePool, isPending: updatingPool } =
		doks.updateNodePool.useMutation();
	const { mutateAsync: deleteNodePool } = doks.deleteNodePool.useMutation();

	const kubeconfigQuery = doks.kubeconfig.useQuery(
		{ doksClusterId: cluster.doksClusterId },
		{ enabled: false },
	);

	const handleDownloadKubeconfig = async () => {
		try {
			const result = await kubeconfigQuery.refetch();
			if (result.data) {
				const blob = new Blob([JSON.stringify(result.data, null, 2)], {
					type: "application/yaml",
				});
				const url = URL.createObjectURL(blob);
				const a = document.createElement("a");
				a.href = url;
				a.download = `kubeconfig-${cluster.name || cluster.doksClusterId}.yaml`;
				document.body.appendChild(a);
				a.click();
				document.body.removeChild(a);
				URL.revokeObjectURL(url);
				toast.success("Kubeconfig downloaded");
			}
		} catch (error: any) {
			toast.error(error?.message || "Failed to download kubeconfig");
		}
	};

	const handleDeleteCluster = async () => {
		try {
			await deleteCluster({ doksClusterId: cluster.doksClusterId });
			toast.success("Cluster deletion started");
			onUpdate();
		} catch (error: any) {
			toast.error(error?.message || "Failed to delete cluster");
		}
	};

	const handleUpgradeHA = async () => {
		try {
			await upgradeToHA({ doksClusterId: cluster.doksClusterId });
			toast.success("HA upgrade started");
			onUpdate();
		} catch (error: any) {
			toast.error(error?.message || "Failed to upgrade to HA");
		}
	};

	const handleInstallBaseline = async () => {
		try {
			await installBaseline({ doksClusterId: cluster.doksClusterId });
			toast.success("Operator + baseline installed — cluster is ready");
			onUpdate();
		} catch (error: any) {
			toast.error(error?.message || "Failed to install baseline");
		}
	};

	const handleSelectTarget = async () => {
		try {
			await selectTarget({ doksClusterId: cluster.doksClusterId });
			toast.success(`Deploys now target "${cluster.name}"`);
			onUpdate();
		} catch (error: any) {
			toast.error(error?.message || "Failed to select deploy target");
		}
	};

	const handleClearTarget = async () => {
		try {
			await selectTarget({ doksClusterId: null });
			toast.success("Reverted to the shared cluster");
			onUpdate();
		} catch (error: any) {
			toast.error(error?.message || "Failed to clear deploy target");
		}
	};

	const handleAddNodePool = async () => {
		try {
			await addNodePool({
				doksClusterId: cluster.doksClusterId,
				name: poolName,
				size: poolSize,
				count: poolCount,
			});
			toast.success("Node pool added");
			setAddPoolOpen(false);
			setPoolName("");
			setPoolSize("s-2vcpu-4gb");
			setPoolCount(2);
			onUpdate();
		} catch (error: any) {
			toast.error(error?.message || "Failed to add node pool");
		}
	};

	const handleUpdateNodePool = async () => {
		if (!editingPool) return;
		try {
			await updateNodePool({
				doksClusterId: cluster.doksClusterId,
				poolId: editingPool.poolId,
				count: editPoolCount,
				size: editPoolSize || undefined,
			});
			toast.success("Node pool updated");
			setEditPoolOpen(false);
			setEditingPool(null);
			onUpdate();
		} catch (error: any) {
			toast.error(error?.message || "Failed to update node pool");
		}
	};

	const handleDeleteNodePool = async (poolId: string) => {
		try {
			await deleteNodePool({
				doksClusterId: cluster.doksClusterId,
				poolId,
			});
			toast.success("Node pool deleted");
			onUpdate();
		} catch (error: any) {
			toast.error(error?.message || "Failed to delete node pool");
		}
	};

	const openEditPool = (pool: any) => {
		setEditingPool(pool);
		setEditPoolCount(pool.count);
		setEditPoolSize(pool.size);
		setEditPoolOpen(true);
	};

	const statusVariant = STATUS_VARIANTS[cluster.status] || "secondary";
	const phaseVariant = PHASE_VARIANTS[cluster.phase] || "secondary";
	const phaseLabel = PHASE_LABELS[cluster.phase] || cluster.phase;
	const isRunning = cluster.status === "running";
	const isReady = cluster.phase === "ready";
	// Baseline can be (re)installed once the cluster is up; "installing" is the
	// only phase where another install is already in flight.
	const canInstallBaseline = isRunning && cluster.phase !== "installing";

	return (
		<Card className="border">
			<CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap pb-3">
				<div className="flex flex-col gap-1">
					<div className="flex items-center gap-3 flex-wrap">
						<CardTitle className="text-lg">
							{cluster.name || cluster.doksClusterId}
						</CardTitle>
						<Badge variant={statusVariant}>{cluster.status}</Badge>
						<Badge variant={phaseVariant}>{phaseLabel}</Badge>
						{isExternal && <Badge variant="outline">BYO</Badge>}
						{cluster.active && (
							<Badge variant="default" className="gap-1">
								<Rocket className="size-3" />
								Deploy target
							</Badge>
						)}
						{cluster.ha && (
							<Badge variant="outline" className="gap-1">
								<Shield className="size-3" />
								HA
							</Badge>
						)}
					</div>
					{cluster.phase === "error" && cluster.baselineError && (
						<span className="text-xs text-destructive max-w-md truncate">
							{cluster.baselineError}
						</span>
					)}
					<div className="flex items-center gap-4 text-sm text-muted-foreground">
						<span>Region: {cluster.region}</span>
						<span>K8s: {cluster.k8sVersion}</span>
						{cost && (
							<span className="font-medium text-primary">
								$
								{typeof cost === "object" && "monthlyTotal" in cost
									? (cost as any).monthlyTotal?.toFixed(2)
									: "---"}
								/mo
							</span>
						)}
					</div>
				</div>
				<div className="flex items-center gap-2">
					{/* Deploy-target selection — only a ready cluster can take deploys. */}
					{isReady &&
						(cluster.active ? (
							<Button
								variant="outline"
								size="sm"
								onClick={handleClearTarget}
								disabled={selecting}
							>
								{selecting ? (
									<Loader2 className="mr-1.5 size-3.5 animate-spin" />
								) : (
									<Rocket className="mr-1.5 size-3.5" />
								)}
								Stop targeting
							</Button>
						) : (
							<Button
								variant="default"
								size="sm"
								onClick={handleSelectTarget}
								disabled={selecting}
							>
								{selecting ? (
									<Loader2 className="mr-1.5 size-3.5 animate-spin" />
								) : (
									<Rocket className="mr-1.5 size-3.5" />
								)}
								Use as deploy target
							</Button>
						))}
					{/* Install/repair the operator + baseline before the cluster is usable. */}
					{canInstallBaseline && !isReady && (
						<Button
							variant="default"
							size="sm"
							onClick={handleInstallBaseline}
							disabled={installingBaseline}
						>
							{installingBaseline ? (
								<Loader2 className="mr-1.5 size-3.5 animate-spin" />
							) : (
								<Layers className="mr-1.5 size-3.5" />
							)}
							Install baseline
						</Button>
					)}
					{!isExternal && (
						<Button
							variant="outline"
							size="sm"
							onClick={handleDownloadKubeconfig}
							disabled={!isRunning}
						>
							<Download className="mr-1.5 size-3.5" />
							Kubeconfig
						</Button>
					)}
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="ghost" className="h-8 w-8 p-0">
								<span className="sr-only">Open menu</span>
								<MoreHorizontal className="h-4 w-4" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuLabel>Actions</DropdownMenuLabel>
							{isReady && (
								<DialogAction
									title="Reinstall baseline"
									description="Re-apply the hanzo-operator + per-tenant baseline (namespaces, PaaS ticket secret, ingress + gateway) onto this cluster. Idempotent."
									type="default"
									onClick={handleInstallBaseline}
								>
									<DropdownMenuItem onSelect={(e) => e.preventDefault()}>
										<Layers className="mr-2 size-3.5" />
										Reinstall baseline
									</DropdownMenuItem>
								</DialogAction>
							)}
							{!isExternal && !cluster.ha && isRunning && (
								<DialogAction
									title="Upgrade to HA"
									description="This will upgrade the cluster control plane to High Availability. This action cannot be reversed."
									type="default"
									onClick={handleUpgradeHA}
								>
									<DropdownMenuItem onSelect={(e) => e.preventDefault()}>
										<Shield className="mr-2 size-3.5" />
										Upgrade to HA
									</DropdownMenuItem>
								</DialogAction>
							)}
							<DropdownMenuSeparator />
							<DialogAction
								title={isExternal ? "Detach Cluster" : "Delete Cluster"}
								description={
									isExternal
										? `Detach cluster "${cluster.name || cluster.doksClusterId}"? Platform stops targeting it; your external cluster and its workloads are left untouched.`
										: `Are you sure you want to delete cluster "${cluster.name || cluster.doksClusterId}"? This will destroy all workloads and cannot be undone.`
								}
								type="destructive"
								onClick={handleDeleteCluster}
							>
								<DropdownMenuItem
									onSelect={(e) => e.preventDefault()}
									className="text-destructive"
								>
									<Trash2 className="mr-2 size-3.5" />
									{isExternal ? "Detach Cluster" : "Delete Cluster"}
								</DropdownMenuItem>
							</DialogAction>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</CardHeader>

			<CardContent className="pt-0">
				{isExternal ? (
					/* BYO clusters have no DO-managed node pools; show their endpoint. */
					<div className="text-sm text-muted-foreground py-2 border-t">
						External endpoint:{" "}
						<span className="font-mono text-xs text-foreground">
							{cluster.endpoint || "—"}
						</span>
					</div>
				) : (
					/* Node Pools Toggle (DO-managed clusters only) */
					<button
						type="button"
						className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-primary transition-colors w-full py-2 border-t"
						onClick={() => setExpanded(!expanded)}
					>
						{expanded ? (
							<ChevronUp className="size-4" />
						) : (
							<ChevronDown className="size-4" />
						)}
						Node Pools ({cluster.nodePools?.length || 0})
					</button>
				)}

				{!isExternal && expanded && (
					<div className="mt-2 space-y-3">
						{cluster.nodePools && cluster.nodePools.length > 0 ? (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Name</TableHead>
										<TableHead>Size</TableHead>
										<TableHead className="text-center">Count</TableHead>
										<TableHead className="text-center">Auto Scale</TableHead>
										<TableHead className="text-right">Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{cluster.nodePools.map((pool: any) => (
										<TableRow key={pool.poolId}>
											<TableCell className="font-medium">{pool.name}</TableCell>
											<TableCell>{pool.size}</TableCell>
											<TableCell className="text-center">
												{pool.count}
												{pool.autoScale && (
													<span className="text-xs text-muted-foreground ml-1">
														({pool.minNodes}-{pool.maxNodes})
													</span>
												)}
											</TableCell>
											<TableCell className="text-center">
												<Badge
													variant={pool.autoScale ? "default" : "secondary"}
												>
													{pool.autoScale ? "On" : "Off"}
												</Badge>
											</TableCell>
											<TableCell className="text-right">
												<div className="flex items-center justify-end gap-1">
													<Button
														variant="ghost"
														size="sm"
														onClick={() => openEditPool(pool)}
													>
														Edit
													</Button>
													<DialogAction
														title="Delete Node Pool"
														description={`Delete node pool "${pool.name}"? All nodes in this pool will be drained and removed.`}
														type="destructive"
														onClick={() => handleDeleteNodePool(pool.poolId)}
													>
														<Button
															variant="ghost"
															size="sm"
															className="text-destructive"
														>
															Delete
														</Button>
													</DialogAction>
												</div>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						) : (
							<div className="text-sm text-muted-foreground text-center py-4">
								No node pools configured.
							</div>
						)}

						{/* Add Node Pool Button */}
						<Dialog open={addPoolOpen} onOpenChange={setAddPoolOpen}>
							<DialogTrigger asChild>
								<Button variant="outline" size="sm" className="gap-1.5">
									<PlusIcon className="size-3.5" />
									Add Node Pool
								</Button>
							</DialogTrigger>
							<DialogContent className="sm:max-w-md">
								<DialogHeader>
									<DialogTitle>Add Node Pool</DialogTitle>
									<DialogDescription>
										Add a new node pool to this cluster.
									</DialogDescription>
								</DialogHeader>
								<div className="flex flex-col gap-4 py-4">
									<div className="flex flex-col gap-2">
										<Label htmlFor="poolName">Pool Name</Label>
										<Input
											id="poolName"
											value={poolName}
											onChange={(e) => setPoolName(e.target.value)}
											placeholder="e.g. worker-pool"
										/>
									</div>
									<div className="flex flex-col gap-2">
										<Label htmlFor="poolSize">Node Size</Label>
										<Select value={poolSize} onValueChange={setPoolSize}>
											<SelectTrigger>
												<SelectValue placeholder="Select node size" />
											</SelectTrigger>
											<SelectContent>
												{nodeSizes?.map((s: any) => (
													<SelectItem key={s.slug} value={s.slug}>
														{s.slug} - {s.vcpus} vCPU / {s.memory}MB
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>
									<div className="flex flex-col gap-2">
										<Label htmlFor="poolCount">Node Count</Label>
										<Input
											id="poolCount"
											type="number"
											min={1}
											max={20}
											value={poolCount}
											onChange={(e) => setPoolCount(Number(e.target.value))}
										/>
									</div>
								</div>
								<DialogFooter>
									<Button
										variant="secondary"
										onClick={() => setAddPoolOpen(false)}
										disabled={addingPool}
									>
										Cancel
									</Button>
									<Button
										onClick={handleAddNodePool}
										disabled={addingPool || !poolName}
									>
										{addingPool ? (
											<>
												<Loader2 className="mr-2 h-4 w-4 animate-spin" />
												Adding...
											</>
										) : (
											"Add Pool"
										)}
									</Button>
								</DialogFooter>
							</DialogContent>
						</Dialog>

						{/* Edit Node Pool Dialog */}
						<Dialog open={editPoolOpen} onOpenChange={setEditPoolOpen}>
							<DialogContent className="sm:max-w-md">
								<DialogHeader>
									<DialogTitle>Edit Node Pool</DialogTitle>
									<DialogDescription>
										Update node pool "{editingPool?.name}".
									</DialogDescription>
								</DialogHeader>
								<div className="flex flex-col gap-4 py-4">
									<div className="flex flex-col gap-2">
										<Label htmlFor="editPoolSize">Node Size</Label>
										<Select
											value={editPoolSize}
											onValueChange={setEditPoolSize}
										>
											<SelectTrigger>
												<SelectValue placeholder="Select node size" />
											</SelectTrigger>
											<SelectContent>
												{nodeSizes?.map((s: any) => (
													<SelectItem key={s.slug} value={s.slug}>
														{s.slug} - {s.vcpus} vCPU / {s.memory}MB
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>
									<div className="flex flex-col gap-2">
										<Label htmlFor="editPoolCount">Node Count</Label>
										<Input
											id="editPoolCount"
											type="number"
											min={1}
											max={20}
											value={editPoolCount}
											onChange={(e) => setEditPoolCount(Number(e.target.value))}
										/>
									</div>
								</div>
								<DialogFooter>
									<Button
										variant="secondary"
										onClick={() => setEditPoolOpen(false)}
										disabled={updatingPool}
									>
										Cancel
									</Button>
									<Button
										onClick={handleUpdateNodePool}
										disabled={updatingPool}
									>
										{updatingPool ? (
											<>
												<Loader2 className="mr-2 h-4 w-4 animate-spin" />
												Updating...
											</>
										) : (
											"Update Pool"
										)}
									</Button>
								</DialogFooter>
							</DialogContent>
						</Dialog>
					</div>
				)}
			</CardContent>
		</Card>
	);
};
