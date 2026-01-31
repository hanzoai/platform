/**
 * ComputePoolCard
 *
 * Displays compute pool information including name, status, node count,
 * and aggregate resources. Includes scale up/down action buttons.
 */

import { Server, Cpu, HardDrive, Layers, Plus, Minus, Activity } from "lucide-react";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScalePoolDialog } from "./ScalePoolDialog";
import type { RouterOutputs } from "@/utils/api";

// ============================================================================
// Types
// ============================================================================

type ComputePool = {
	poolId: string;
	name: string;
	slug: string;
	description?: string | null;
	status: "pending" | "active" | "maintenance" | "suspended" | "decommissioned";
	primaryRegion?: string | null;
	regions: string[];
	totalCpuCores: number;
	totalMemoryMb: number;
	totalStorageGb: number;
	totalGpuCount: number;
	availableCpuCores: number;
	availableMemoryMb: number;
	availableStorageGb: number;
	availableGpuCount: number;
	totalNodes: number;
	activeNodes: number;
};

interface ComputePoolCardProps {
	pool: ComputePool;
	providerId: string;
	onScaleStart?: () => void;
}

// ============================================================================
// Component
// ============================================================================

export function ComputePoolCard({ pool, providerId, onScaleStart }: ComputePoolCardProps) {
	const cpuUtilization =
		pool.totalCpuCores > 0
			? ((pool.totalCpuCores - pool.availableCpuCores) / pool.totalCpuCores) * 100
			: 0;
	const memoryUtilization =
		pool.totalMemoryMb > 0
			? ((pool.totalMemoryMb - pool.availableMemoryMb) / pool.totalMemoryMb) * 100
			: 0;
	const storageUtilization =
		pool.totalStorageGb > 0
			? ((pool.totalStorageGb - pool.availableStorageGb) / pool.totalStorageGb) * 100
			: 0;

	return (
		<Card className="bg-sidebar">
			<CardHeader className="pb-3">
				<div className="flex items-start justify-between">
					<div className="flex items-center gap-3">
						<div className="p-2 rounded-lg bg-primary/10">
							<Layers className="h-5 w-5 text-primary" />
						</div>
						<div>
							<CardTitle className="text-lg">{pool.name}</CardTitle>
							<CardDescription className="text-xs">
								{pool.slug} | {pool.primaryRegion || pool.regions[0] || "No region"}
							</CardDescription>
						</div>
					</div>
					<PoolStatusBadge status={pool.status} />
				</div>
			</CardHeader>

			<CardContent className="space-y-4">
				{/* Node Count */}
				<div className="flex items-center justify-between p-3 rounded-lg bg-background">
					<div className="flex items-center gap-2">
						<Server className="h-4 w-4 text-muted-foreground" />
						<span className="text-sm font-medium">Nodes</span>
					</div>
					<div className="text-right">
						<span className="text-2xl font-bold">{pool.activeNodes}</span>
						<span className="text-sm text-muted-foreground"> / {pool.totalNodes}</span>
					</div>
				</div>

				{/* Resource Utilization */}
				<div className="space-y-3">
					<ResourceBar
						icon={<Cpu className="h-3 w-3" />}
						label="CPU"
						used={pool.totalCpuCores - pool.availableCpuCores}
						total={pool.totalCpuCores}
						unit="cores"
						utilization={cpuUtilization}
					/>
					<ResourceBar
						icon={<Activity className="h-3 w-3" />}
						label="Memory"
						used={pool.totalMemoryMb - pool.availableMemoryMb}
						total={pool.totalMemoryMb}
						unit="MB"
						utilization={memoryUtilization}
						formatValue={formatMemory}
					/>
					<ResourceBar
						icon={<HardDrive className="h-3 w-3" />}
						label="Storage"
						used={pool.totalStorageGb - pool.availableStorageGb}
						total={pool.totalStorageGb}
						unit="GB"
						utilization={storageUtilization}
					/>
					{pool.totalGpuCount > 0 && (
						<ResourceBar
							icon={<Cpu className="h-3 w-3" />}
							label="GPU"
							used={pool.totalGpuCount - pool.availableGpuCount}
							total={pool.totalGpuCount}
							unit="units"
							utilization={
								((pool.totalGpuCount - pool.availableGpuCount) / pool.totalGpuCount) * 100
							}
						/>
					)}
				</div>

				{/* Actions */}
				<div className="flex items-center gap-2 pt-2 border-t">
					<ScalePoolDialog
						poolId={pool.poolId}
						providerId={providerId}
						currentNodes={pool.totalNodes}
						poolName={pool.name}
						onScaleStart={onScaleStart}
					>
						<Button variant="outline" size="sm" className="flex-1">
							<Plus className="h-4 w-4 mr-1" />
							Scale Up
						</Button>
					</ScalePoolDialog>

					<ScalePoolDialog
						poolId={pool.poolId}
						providerId={providerId}
						currentNodes={pool.totalNodes}
						poolName={pool.name}
						defaultDirection="down"
						onScaleStart={onScaleStart}
					>
						<Button
							variant="outline"
							size="sm"
							className="flex-1"
							disabled={pool.totalNodes === 0}
						>
							<Minus className="h-4 w-4 mr-1" />
							Scale Down
						</Button>
					</ScalePoolDialog>
				</div>
			</CardContent>
		</Card>
	);
}

// ============================================================================
// Helper Components
// ============================================================================

interface ResourceBarProps {
	icon: React.ReactNode;
	label: string;
	used: number;
	total: number;
	unit: string;
	utilization: number;
	formatValue?: (value: number) => string;
}

function ResourceBar({
	icon,
	label,
	used,
	total,
	unit,
	utilization,
	formatValue,
}: ResourceBarProps) {
	const format = formatValue || ((v: number) => v.toString());

	return (
		<div className="space-y-1">
			<div className="flex items-center justify-between text-xs">
				<span className="flex items-center gap-1 text-muted-foreground">
					{icon}
					{label}
				</span>
				<span className="text-muted-foreground">
					{format(used)} / {format(total)} {unit}
				</span>
			</div>
			<Progress value={utilization} className="h-1.5" />
		</div>
	);
}

function formatMemory(mb: number): string {
	if (mb >= 1024) {
		return `${(mb / 1024).toFixed(1)}GB`;
	}
	return `${mb}MB`;
}

interface PoolStatusBadgeProps {
	status: ComputePool["status"];
}

function PoolStatusBadge({ status }: PoolStatusBadgeProps) {
	const variants: Record<ComputePool["status"], "green" | "yellow" | "red" | "blue" | "blank"> = {
		active: "green",
		pending: "yellow",
		maintenance: "blue",
		suspended: "red",
		decommissioned: "blank",
	};

	const labels: Record<ComputePool["status"], string> = {
		active: "Active",
		pending: "Pending",
		maintenance: "Maintenance",
		suspended: "Suspended",
		decommissioned: "Decommissioned",
	};

	return <Badge variant={variants[status]}>{labels[status]}</Badge>;
}
