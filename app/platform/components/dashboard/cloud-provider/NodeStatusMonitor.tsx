/**
 * NodeStatusMonitor
 *
 * Grid of node cards displaying real-time status, resource utilization,
 * and health metrics for all nodes in a compute pool.
 */

import { useState } from "react";
import {
	Server,
	Cpu,
	HardDrive,
	Activity,
	Wifi,
	WifiOff,
	MoreVertical,
	RefreshCw,
	Trash2,
	Loader2,
	Clock,
	Globe,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/utils/api";

// ============================================================================
// Types
// ============================================================================

interface PoolInstance {
	instanceId: string;
	externalName: string;
	region: string;
	size: string;
	status: "pending" | "provisioning" | "booting" | "registering" | "running" | "draining" | "stopping" | "terminated" | "failed";
	publicIp: string | null;
	privateIp: string | null;
	cpuCores: number;
	memoryMb: number;
	storageGb: number;
	createdAt: Date;
	computeNode?: {
		nodeId: string;
		name: string;
		status: "online" | "offline" | "syncing" | "draining" | "maintenance";
		cpuUtilizationPercent: string | null;
		memoryUtilizationPercent: string | null;
		storageUtilizationPercent: string | null;
		gpuUtilizationPercent: string | null;
		lastHeartbeat: Date | null;
		healthScore: string | null;
	} | null;
}

interface NodeStatusMonitorProps {
	poolId: string;
	className?: string;
}

// ============================================================================
// Component
// ============================================================================

export function NodeStatusMonitor({ poolId, className }: NodeStatusMonitorProps) {
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [selectedInstance, setSelectedInstance] = useState<PoolInstance | null>(null);
	const [isDraining, setIsDraining] = useState<string | null>(null);

	const utils = api.useUtils();

	// Fetch instances with polling
	const { data: instances, isLoading, isRefetching } = api.digitalocean.listPoolInstances.useQuery(
		{ poolId },
		{ refetchInterval: 10000 } // Poll every 10 seconds
	);

	// Drain mutation
	const drainMutation = api.digitalocean.drainNode.useMutation({
		onSuccess: () => {
			toast.success("Node drain started");
			utils.digitalocean.listPoolInstances.invalidate({ poolId });
		},
		onError: (error) => {
			toast.error(`Failed to drain node: ${error.message}`);
		},
		onSettled: () => {
			setIsDraining(null);
		},
	});

	// Remove mutation
	const removeMutation = api.digitalocean.removeInstance.useMutation({
		onSuccess: () => {
			toast.success("Node removal started");
			utils.digitalocean.listPoolInstances.invalidate({ poolId });
			setDeleteDialogOpen(false);
			setSelectedInstance(null);
		},
		onError: (error) => {
			toast.error(`Failed to remove node: ${error.message}`);
		},
	});

	const handleDrain = (instance: PoolInstance) => {
		if (!instance.computeNode) return;
		setIsDraining(instance.instanceId);
		drainMutation.mutate({ nodeId: instance.computeNode.nodeId, force: false });
	};

	const handleRemove = (instance: PoolInstance) => {
		setSelectedInstance(instance);
		setDeleteDialogOpen(true);
	};

	const confirmRemove = () => {
		if (selectedInstance) {
			removeMutation.mutate({ instanceId: selectedInstance.instanceId, force: false });
		}
	};

	if (isLoading) {
		return (
			<div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 ${className}`}>
				{[1, 2, 3].map((i) => (
					<Card key={i} className="bg-sidebar">
						<CardHeader className="pb-2">
							<Skeleton className="h-5 w-32" />
						</CardHeader>
						<CardContent className="space-y-3">
							<Skeleton className="h-4 w-full" />
							<Skeleton className="h-4 w-3/4" />
							<Skeleton className="h-2 w-full" />
							<Skeleton className="h-2 w-full" />
						</CardContent>
					</Card>
				))}
			</div>
		);
	}

	if (!instances || instances.length === 0) {
		return (
			<Card className={`bg-sidebar ${className}`}>
				<CardContent className="flex flex-col items-center justify-center py-12 text-center">
					<Server className="h-12 w-12 text-muted-foreground mb-4" />
					<h3 className="text-lg font-medium">No Nodes</h3>
					<p className="text-sm text-muted-foreground mt-1">
						Scale up your pool to add compute nodes
					</p>
				</CardContent>
			</Card>
		);
	}

	return (
		<>
			<div className="flex items-center justify-between mb-4">
				<div className="text-sm text-muted-foreground">
					{instances.length} node{instances.length !== 1 ? "s" : ""} in pool
				</div>
				{isRefetching && (
					<div className="flex items-center gap-1 text-xs text-muted-foreground">
						<RefreshCw className="h-3 w-3 animate-spin" />
						Refreshing...
					</div>
				)}
			</div>

			<div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 ${className}`}>
				{instances.map((instance) => (
					<NodeCard
						key={instance.instanceId}
						instance={instance}
						onDrain={() => handleDrain(instance)}
						onRemove={() => handleRemove(instance)}
						isDraining={isDraining === instance.instanceId}
					/>
				))}
			</div>

			{/* Delete Confirmation Dialog */}
			<AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Remove Node?</AlertDialogTitle>
						<AlertDialogDescription>
							This will drain workloads and delete the instance{" "}
							<strong>{selectedInstance?.externalName}</strong> from the cloud provider.
							This action cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={confirmRemove}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							{removeMutation.isPending ? (
								<Loader2 className="h-4 w-4 mr-2 animate-spin" />
							) : (
								<Trash2 className="h-4 w-4 mr-2" />
							)}
							Remove Node
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

// ============================================================================
// Node Card Component
// ============================================================================

interface NodeCardProps {
	instance: PoolInstance;
	onDrain: () => void;
	onRemove: () => void;
	isDraining: boolean;
}

function NodeCard({ instance, onDrain, onRemove, isDraining }: NodeCardProps) {
	const node = instance.computeNode;

	const cpuUtil = node?.cpuUtilizationPercent ? parseFloat(node.cpuUtilizationPercent) : 0;
	const memUtil = node?.memoryUtilizationPercent ? parseFloat(node.memoryUtilizationPercent) : 0;
	const storageUtil = node?.storageUtilizationPercent
		? parseFloat(node.storageUtilizationPercent)
		: 0;

	const isHealthy = node?.status === "online" && instance.status === "running";
	const lastHeartbeat = node?.lastHeartbeat
		? formatDistanceToNow(new Date(node.lastHeartbeat), { addSuffix: true })
		: "Never";

	return (
		<Card className="bg-sidebar">
			<CardHeader className="pb-2">
				<div className="flex items-center justify-between">
					<CardTitle className="text-sm flex items-center gap-2">
						{isHealthy ? (
							<Wifi className="h-4 w-4 text-green-500" />
						) : (
							<WifiOff className="h-4 w-4 text-red-500" />
						)}
						<span className="truncate max-w-[150px]">{instance.externalName}</span>
					</CardTitle>
					<div className="flex items-center gap-1">
						<NodeStatusBadge status={instance.status} nodeStatus={node?.status} />
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button variant="ghost" size="sm" className="h-7 w-7 p-0">
									<MoreVertical className="h-4 w-4" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuItem
									onClick={onDrain}
									disabled={
										!node ||
										instance.status !== "running" ||
										isDraining
									}
								>
									{isDraining ? (
										<Loader2 className="h-4 w-4 mr-2 animate-spin" />
									) : (
										<Activity className="h-4 w-4 mr-2" />
									)}
									Drain Node
								</DropdownMenuItem>
								<DropdownMenuSeparator />
								<DropdownMenuItem
									onClick={onRemove}
									className="text-destructive focus:text-destructive"
								>
									<Trash2 className="h-4 w-4 mr-2" />
									Remove Node
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</div>
			</CardHeader>
			<CardContent className="space-y-3">
				{/* Metadata */}
				<div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
					<div className="flex items-center gap-1 text-muted-foreground">
						<Globe className="h-3 w-3" />
						{instance.region}
					</div>
					<div className="flex items-center gap-1 text-muted-foreground">
						<Server className="h-3 w-3" />
						{instance.size}
					</div>
					{instance.publicIp && (
						<Tooltip>
							<TooltipTrigger asChild>
								<div className="flex items-center gap-1 text-muted-foreground truncate cursor-help">
									<Wifi className="h-3 w-3 flex-shrink-0" />
									<span className="font-mono truncate">{instance.publicIp}</span>
								</div>
							</TooltipTrigger>
							<TooltipContent>
								<p>Public IP: {instance.publicIp}</p>
								{instance.privateIp && <p>Private IP: {instance.privateIp}</p>}
							</TooltipContent>
						</Tooltip>
					)}
					<div className="flex items-center gap-1 text-muted-foreground">
						<Clock className="h-3 w-3" />
						{lastHeartbeat}
					</div>
				</div>

				{/* Resource Utilization (only if node is registered) */}
				{node && instance.status === "running" && (
					<div className="space-y-2 pt-2 border-t">
						<UtilizationBar
							icon={<Cpu className="h-3 w-3" />}
							label="CPU"
							value={cpuUtil}
						/>
						<UtilizationBar
							icon={<Activity className="h-3 w-3" />}
							label="Memory"
							value={memUtil}
						/>
						<UtilizationBar
							icon={<HardDrive className="h-3 w-3" />}
							label="Storage"
							value={storageUtil}
						/>
					</div>
				)}

				{/* Provisioning state */}
				{["pending", "provisioning", "booting", "registering"].includes(instance.status) && (
					<div className="flex items-center justify-center py-3 text-sm text-muted-foreground">
						<Loader2 className="h-4 w-4 mr-2 animate-spin" />
						{getProvisioningLabel(instance.status)}
					</div>
				)}
			</CardContent>
		</Card>
	);
}

// ============================================================================
// Helper Components
// ============================================================================

interface UtilizationBarProps {
	icon: React.ReactNode;
	label: string;
	value: number;
}

function UtilizationBar({ icon, label, value }: UtilizationBarProps) {
	const colorClass =
		value > 80 ? "bg-red-500" : value > 60 ? "bg-yellow-500" : "bg-primary";

	return (
		<div className="space-y-1">
			<div className="flex items-center justify-between text-xs">
				<span className="flex items-center gap-1 text-muted-foreground">
					{icon}
					{label}
				</span>
				<span className="text-muted-foreground">{value.toFixed(1)}%</span>
			</div>
			<div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
				<div
					className={`h-full ${colorClass} transition-all`}
					style={{ width: `${Math.min(100, value)}%` }}
				/>
			</div>
		</div>
	);
}

interface NodeStatusBadgeProps {
	status: PoolInstance["status"];
	nodeStatus?: NonNullable<PoolInstance["computeNode"]>["status"];
}

function NodeStatusBadge({ status, nodeStatus }: NodeStatusBadgeProps) {
	// Combine instance and node status for display
	if (status === "running" && nodeStatus === "online") {
		return <Badge variant="green">Online</Badge>;
	}
	if (status === "running" && nodeStatus === "draining") {
		return <Badge variant="yellow">Draining</Badge>;
	}
	if (status === "running" && nodeStatus === "maintenance") {
		return <Badge variant="blue">Maintenance</Badge>;
	}
	if (status === "running" && nodeStatus === "offline") {
		return <Badge variant="red">Offline</Badge>;
	}
	if (status === "running" && nodeStatus === "syncing") {
		return <Badge variant="yellow">Syncing</Badge>;
	}

	const statusMap: Record<PoolInstance["status"], { variant: "green" | "yellow" | "red" | "blue" | "blank"; label: string }> = {
		pending: { variant: "yellow", label: "Pending" },
		provisioning: { variant: "yellow", label: "Provisioning" },
		booting: { variant: "yellow", label: "Booting" },
		registering: { variant: "yellow", label: "Registering" },
		running: { variant: "green", label: "Running" },
		draining: { variant: "blue", label: "Draining" },
		stopping: { variant: "yellow", label: "Stopping" },
		terminated: { variant: "blank", label: "Terminated" },
		failed: { variant: "red", label: "Failed" },
	};

	const { variant, label } = statusMap[status] || { variant: "blank", label: status };
	return <Badge variant={variant}>{label}</Badge>;
}

function getProvisioningLabel(status: PoolInstance["status"]): string {
	const labels: Record<string, string> = {
		pending: "Creating instance...",
		provisioning: "Provisioning...",
		booting: "Booting system...",
		registering: "Registering with cluster...",
	};
	return labels[status] || "Processing...";
}
