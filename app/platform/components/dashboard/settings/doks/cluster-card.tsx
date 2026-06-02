import {
	ChevronDown,
	ChevronUp,
	Download,
	Loader2,
	MoreHorizontal,
	PlusIcon,
	Shield,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DialogAction } from "@/components/shared/dialog-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
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
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
	running: "default",
	provisioning: "secondary",
	pending: "secondary",
	error: "destructive",
	deleting: "outline",
	deleted: "outline",
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

	const { data: cost } = api.doks.clusterCost.useQuery(
		{ doksClusterId: cluster.doksClusterId },
		{ enabled: !!cluster.doksClusterId },
	);

	const { data: nodeSizes } = api.doks.listNodeSizes.useQuery(undefined, {
		enabled: addPoolOpen || editPoolOpen,
	});

	const { mutateAsync: deleteCluster, isLoading: deleting } =
		api.doks.delete.useMutation();
	const { mutateAsync: upgradeToHA, isLoading: upgrading } =
		api.doks.upgradeToHA.useMutation();
	const { mutateAsync: addNodePool, isLoading: addingPool } =
		api.doks.addNodePool.useMutation();
	const { mutateAsync: updateNodePool, isLoading: updatingPool } =
		api.doks.updateNodePool.useMutation();
	const { mutateAsync: deleteNodePool } =
		api.doks.deleteNodePool.useMutation();

	const kubeconfigQuery = api.doks.kubeconfig.useQuery(
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

	return (
		<Card className="border">
			<CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap pb-3">
				<div className="flex flex-col gap-1">
					<div className="flex items-center gap-3">
						<CardTitle className="text-lg">
							{cluster.name || cluster.doksClusterId}
						</CardTitle>
						<Badge variant={statusVariant}>
							{cluster.status}
						</Badge>
						{cluster.ha && (
							<Badge variant="outline" className="gap-1">
								<Shield className="size-3" />
								HA
							</Badge>
						)}
					</div>
					<div className="flex items-center gap-4 text-sm text-muted-foreground">
						<span>Region: {cluster.region}</span>
						<span>K8s: {cluster.k8sVersion}</span>
						{cost && (
							<span className="font-medium text-primary">
								${typeof cost === "object" && "monthlyTotal" in cost
									? (cost as any).monthlyTotal?.toFixed(2)
									: "---"}/mo
							</span>
						)}
					</div>
				</div>
				<div className="flex items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						onClick={handleDownloadKubeconfig}
						disabled={cluster.status !== "running"}
					>
						<Download className="mr-1.5 size-3.5" />
						Kubeconfig
					</Button>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="ghost" className="h-8 w-8 p-0">
								<span className="sr-only">Open menu</span>
								<MoreHorizontal className="h-4 w-4" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuLabel>Actions</DropdownMenuLabel>
							{!cluster.ha && cluster.status === "running" && (
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
								title="Delete Cluster"
								description={`Are you sure you want to delete cluster "${cluster.name || cluster.doksClusterId}"? This will destroy all workloads and cannot be undone.`}
								type="destructive"
								onClick={handleDeleteCluster}
							>
								<DropdownMenuItem
									onSelect={(e) => e.preventDefault()}
									className="text-destructive"
								>
									<Trash2 className="mr-2 size-3.5" />
									Delete Cluster
								</DropdownMenuItem>
							</DialogAction>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</CardHeader>

			<CardContent className="pt-0">
				{/* Node Pools Toggle */}
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

				{expanded && (
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
											<TableCell className="font-medium">
												{pool.name}
											</TableCell>
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
												<Badge variant={pool.autoScale ? "default" : "secondary"}>
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
														<Button variant="ghost" size="sm" className="text-destructive">
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
										<Select value={editPoolSize} onValueChange={setEditPoolSize}>
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
