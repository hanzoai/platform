/**
 * ScalePoolDialog
 *
 * Dialog for scaling a compute pool up or down. Implements the design
 * from DIGITALOCEAN_INTEGRATION_DESIGN.md with direction toggle,
 * count, size, region, and node type selectors.
 */

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, Loader2, Minus, Plus, Server } from "lucide-react";
import { type ReactNode, useState } from "react";
import { type ControllerRenderProps, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { digitalocean } from "@/utils/zap-digitalocean";

// ============================================================================
// Schema
// ============================================================================

const scaleSchema = z
	.object({
		direction: z.enum(["up", "down"]),
		count: z.number().int().min(1).max(10),
		size: z.string().optional(),
		region: z.string().optional(),
		nodeType: z.enum(["worker", "gpu", "storage", "inference"]).optional(),
		strategy: z.enum(["oldest", "newest", "least-utilized"]).optional(),
	})
	.refine(
		(data) => {
			if (data.direction === "up") {
				return data.size && data.region && data.nodeType;
			}
			return true;
		},
		{
			message: "Size, region, and node type are required when scaling up",
			path: ["size"],
		},
	);

type ScaleInput = z.infer<typeof scaleSchema>;

type DropletSize = {
	slug: string;
	price_monthly: number;
	vcpus: number;
	memory: number;
};

type DropletRegion = { slug: string; name: string };

// ============================================================================
// Component
// ============================================================================

interface ScalePoolDialogProps {
	poolId: string;
	providerId: string;
	currentNodes: number;
	poolName: string;
	defaultDirection?: "up" | "down";
	onScaleStart?: () => void;
	children: ReactNode;
}

export function ScalePoolDialog({
	poolId,
	providerId,
	currentNodes,
	poolName,
	defaultDirection = "up",
	onScaleStart,
	children,
}: ScalePoolDialogProps) {
	const [open, setOpen] = useState(false);
	const [isScaling, setIsScaling] = useState(false);

	const utils = digitalocean.useUtils();

	// Fetch available sizes and regions
	const { data: sizes, isLoading: isLoadingSizes } =
		digitalocean.listSizes.useQuery({ providerId }, { enabled: open });
	const { data: regions, isLoading: isLoadingRegions } =
		digitalocean.listRegions.useQuery({ providerId }, { enabled: open });

	// Scale mutations
	const scaleUpMutation = digitalocean.scaleUp.useMutation({
		onSuccess: (data) => {
			toast.success(`Scaling operation started. Job ID: ${data.jobId}`);
			utils.listPoolInstances.invalidate({ poolId });
			utils.listScalingJobs.invalidate({ poolId });
			setOpen(false);
			onScaleStart?.();
		},
		onError: (error) => {
			toast.error(`Scale up failed: ${error.message}`);
		},
	});

	const scaleDownMutation = digitalocean.scaleDown.useMutation({
		onSuccess: (data) => {
			toast.success(`Scale down started. Job ID: ${data.jobId}`);
			utils.listPoolInstances.invalidate({ poolId });
			utils.listScalingJobs.invalidate({ poolId });
			setOpen(false);
			onScaleStart?.();
		},
		onError: (error) => {
			toast.error(`Scale down failed: ${error.message}`);
		},
	});

	const form = useForm<ScaleInput>({
		resolver: zodResolver(scaleSchema),
		defaultValues: {
			direction: defaultDirection,
			count: 1,
			size: "s-2vcpu-4gb",
			region: "nyc1",
			nodeType: "worker",
			strategy: "oldest",
		},
	});

	const direction = form.watch("direction");
	const count = form.watch("count");

	async function onSubmit(values: ScaleInput) {
		setIsScaling(true);
		try {
			if (values.direction === "up") {
				await scaleUpMutation.mutateAsync({
					poolId,
					providerId,
					count: values.count,
					size: values.size!,
					region: values.region!,
					nodeType: values.nodeType!,
				});
			} else {
				await scaleDownMutation.mutateAsync({
					poolId,
					count: values.count,
					strategy: values.strategy || "oldest",
				});
			}
		} finally {
			setIsScaling(false);
		}
	}

	// Calculate estimated monthly cost
	const selectedSize = sizes?.find(
		(s: DropletSize) => s.slug === form.watch("size"),
	);
	const estimatedMonthlyCost = selectedSize
		? selectedSize.price_monthly * count
		: 0;

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>{children}</DialogTrigger>
			<DialogContent className="sm:max-w-[500px]">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Server className="h-5 w-5" />
						Scale Pool: {poolName}
					</DialogTitle>
					<DialogDescription>
						{direction === "up"
							? "Add new compute nodes to the pool"
							: "Remove nodes from the pool"}
					</DialogDescription>
				</DialogHeader>

				<Form {...form}>
					<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
						{/* Direction Toggle */}
						<FormField
							control={form.control}
							name="direction"
							render={({
								field,
							}: {
								field: ControllerRenderProps<ScaleInput, "direction">;
							}) => (
								<FormItem>
									<FormLabel>Direction</FormLabel>
									<div className="flex gap-2">
										<Button
											type="button"
											variant={field.value === "up" ? "default" : "outline"}
											onClick={() => field.onChange("up")}
											className="flex-1"
										>
											<Plus className="w-4 h-4 mr-2" />
											Scale Up
										</Button>
										<Button
											type="button"
											variant={field.value === "down" ? "default" : "outline"}
											onClick={() => field.onChange("down")}
											className="flex-1"
											disabled={currentNodes === 0}
										>
											<Minus className="w-4 h-4 mr-2" />
											Scale Down
										</Button>
									</div>
								</FormItem>
							)}
						/>

						{/* Node Count */}
						<FormField
							control={form.control}
							name="count"
							render={({
								field,
							}: {
								field: ControllerRenderProps<ScaleInput, "count">;
							}) => (
								<FormItem>
									<FormLabel>
										Number of Nodes
										<Badge variant="blank" className="ml-2">
											{currentNodes} current
										</Badge>
									</FormLabel>
									<FormControl>
										<Input
											type="number"
											min={1}
											max={direction === "down" ? currentNodes : 10}
											{...field}
											onChange={(e) =>
												field.onChange(Number.parseInt(e.target.value) || 1)
											}
										/>
									</FormControl>
									<FormDescription>
										{direction === "up"
											? `Will result in ${currentNodes + count} total nodes`
											: `Will result in ${Math.max(0, currentNodes - count)} total nodes`}
									</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>

						{/* Scale Up Options */}
						{direction === "up" && (
							<>
								{/* Instance Size */}
								<FormField
									control={form.control}
									name="size"
									render={({
										field,
									}: {
										field: ControllerRenderProps<ScaleInput, "size">;
									}) => (
										<FormItem>
											<FormLabel>Instance Size</FormLabel>
											<Select
												onValueChange={field.onChange}
												defaultValue={field.value}
											>
												<FormControl>
													<SelectTrigger disabled={isLoadingSizes}>
														<SelectValue placeholder="Select size" />
													</SelectTrigger>
												</FormControl>
												<SelectContent>
													{sizes?.map((size: DropletSize) => (
														<SelectItem key={size.slug} value={size.slug}>
															<div className="flex items-center justify-between w-full">
																<span>{size.slug}</span>
																<span className="text-muted-foreground text-xs ml-2">
																	${size.price_monthly}/mo | {size.vcpus} vCPU |{" "}
																	{size.memory / 1024}GB RAM
																</span>
															</div>
														</SelectItem>
													))}
												</SelectContent>
											</Select>
											<FormMessage />
										</FormItem>
									)}
								/>

								{/* Region */}
								<FormField
									control={form.control}
									name="region"
									render={({
										field,
									}: {
										field: ControllerRenderProps<ScaleInput, "region">;
									}) => (
										<FormItem>
											<FormLabel>Region</FormLabel>
											<Select
												onValueChange={field.onChange}
												defaultValue={field.value}
											>
												<FormControl>
													<SelectTrigger disabled={isLoadingRegions}>
														<SelectValue placeholder="Select region" />
													</SelectTrigger>
												</FormControl>
												<SelectContent>
													{regions?.map((region: DropletRegion) => (
														<SelectItem key={region.slug} value={region.slug}>
															{region.name} ({region.slug})
														</SelectItem>
													))}
												</SelectContent>
											</Select>
											<FormMessage />
										</FormItem>
									)}
								/>

								{/* Node Type */}
								<FormField
									control={form.control}
									name="nodeType"
									render={({
										field,
									}: {
										field: ControllerRenderProps<ScaleInput, "nodeType">;
									}) => (
										<FormItem>
											<FormLabel>Node Type</FormLabel>
											<Select
												onValueChange={field.onChange}
												defaultValue={field.value}
											>
												<FormControl>
													<SelectTrigger>
														<SelectValue placeholder="Select type" />
													</SelectTrigger>
												</FormControl>
												<SelectContent>
													<SelectItem value="worker">
														<div className="flex items-center gap-2">
															<span>Worker</span>
															<span className="text-xs text-muted-foreground">
																General purpose compute
															</span>
														</div>
													</SelectItem>
													<SelectItem value="gpu">
														<div className="flex items-center gap-2">
															<span>GPU</span>
															<span className="text-xs text-muted-foreground">
																GPU-accelerated workloads
															</span>
														</div>
													</SelectItem>
													<SelectItem value="storage">
														<div className="flex items-center gap-2">
															<span>Storage</span>
															<span className="text-xs text-muted-foreground">
																High-capacity storage
															</span>
														</div>
													</SelectItem>
													<SelectItem value="inference">
														<div className="flex items-center gap-2">
															<span>Inference</span>
															<span className="text-xs text-muted-foreground">
																AI inference optimized
															</span>
														</div>
													</SelectItem>
												</SelectContent>
											</Select>
											<FormMessage />
										</FormItem>
									)}
								/>

								{/* Cost Estimate */}
								{estimatedMonthlyCost > 0 && (
									<Alert>
										<AlertDescription className="flex items-center justify-between">
											<span>Estimated monthly cost:</span>
											<span className="font-semibold">
												${estimatedMonthlyCost.toFixed(2)}/month
											</span>
										</AlertDescription>
									</Alert>
								)}
							</>
						)}

						{/* Scale Down Options */}
						{direction === "down" && (
							<>
								<FormField
									control={form.control}
									name="strategy"
									render={({
										field,
									}: {
										field: ControllerRenderProps<ScaleInput, "strategy">;
									}) => (
										<FormItem>
											<FormLabel>Removal Strategy</FormLabel>
											<Select
												onValueChange={field.onChange}
												defaultValue={field.value}
											>
												<FormControl>
													<SelectTrigger>
														<SelectValue placeholder="Select strategy" />
													</SelectTrigger>
												</FormControl>
												<SelectContent>
													<SelectItem value="oldest">
														<div className="flex items-center gap-2">
															<span>Oldest First</span>
															<span className="text-xs text-muted-foreground">
																Remove oldest nodes
															</span>
														</div>
													</SelectItem>
													<SelectItem value="newest">
														<div className="flex items-center gap-2">
															<span>Newest First</span>
															<span className="text-xs text-muted-foreground">
																Remove newest nodes
															</span>
														</div>
													</SelectItem>
													<SelectItem value="least-utilized">
														<div className="flex items-center gap-2">
															<span>Least Utilized</span>
															<span className="text-xs text-muted-foreground">
																Remove least used nodes
															</span>
														</div>
													</SelectItem>
												</SelectContent>
											</Select>
											<FormDescription>
												Nodes will be drained before removal to migrate
												workloads
											</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>

								{count >= currentNodes && currentNodes > 0 && (
									<Alert variant="destructive">
										<AlertTriangle className="h-4 w-4" />
										<AlertDescription>
											This will remove all nodes from the pool. Workloads will
											be unavailable.
										</AlertDescription>
									</Alert>
								)}
							</>
						)}

						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => setOpen(false)}
								disabled={isScaling}
							>
								Cancel
							</Button>
							<Button type="submit" disabled={isScaling}>
								{isScaling && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
								{direction === "up" ? "Add Nodes" : "Remove Nodes"}
							</Button>
						</DialogFooter>
					</form>
				</Form>
			</DialogContent>
		</Dialog>
	);
}
