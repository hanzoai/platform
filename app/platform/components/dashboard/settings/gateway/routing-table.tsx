import { standardSchemaResolver as zodResolver } from "@hookform/resolvers/standard-schema";
import { Loader2, Pencil, PlusIcon, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { DialogAction } from "@/components/shared/dialog-action";
import { Badge } from "@/components/ui/badge";
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
	Form,
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { gateway } from "@/utils/zap-gateway";

const routingFormSchema = z.object({
	name: z.string().min(1, "Name is required"),
	host: z.string().min(1, "Host is required"),
	pathPrefix: z.string().optional(),
	backend: z.string().min(1, "Backend is required"),
	priority: z.number().int().min(0, "Priority must be >= 0"),
	middlewares: z.string(),
	enabled: z.boolean(),
});

type RoutingFormValues = z.infer<typeof routingFormSchema>;

interface RoutingDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	defaultValues?: RoutingFormValues & { routingRuleId?: string };
	mode: "create" | "edit";
}

const RoutingDialog = ({
	open,
	onOpenChange,
	defaultValues,
	mode,
}: RoutingDialogProps) => {
	const utils = gateway.useUtils();

	const { mutateAsync: createMutation, isPending: isCreating } =
		gateway.createRoute.useMutation();
	const { mutateAsync: updateMutation, isPending: isUpdating } =
		gateway.updateRoute.useMutation();

	const isSubmitting = isCreating || isUpdating;

	const form = useForm<RoutingFormValues>({
		resolver: zodResolver(routingFormSchema),
		defaultValues: defaultValues ?? {
			name: "",
			host: "",
			pathPrefix: "",
			backend: "",
			priority: 0,
			middlewares: "",
			enabled: true,
		},
	});

	useEffect(() => {
		if (open && defaultValues) {
			form.reset(defaultValues);
		} else if (open) {
			form.reset({
				name: "",
				host: "",
				pathPrefix: "",
				backend: "",
				priority: 0,
				middlewares: "",
				enabled: true,
			});
		}
	}, [open, defaultValues, form]);

	const onSubmit = async (data: RoutingFormValues) => {
		const middlewaresArray = data.middlewares
			? data.middlewares
					.split(",")
					.map((m) => m.trim())
					.filter(Boolean)
			: [];

		const payload = {
			name: data.name,
			host: data.host,
			pathPrefix: data.pathPrefix || undefined,
			backend: data.backend,
			priority: data.priority,
			middlewares: middlewaresArray,
			enabled: data.enabled,
		};

		if (mode === "edit" && defaultValues?.routingRuleId) {
			await updateMutation({
				routingRuleId: defaultValues.routingRuleId,
				...payload,
			})
				.then(async () => {
					toast.success("Route updated");
					await utils.listRoutes.invalidate();
					onOpenChange(false);
				})
				.catch(() => {
					toast.error("Failed to update route");
				});
		} else {
			await createMutation(payload)
				.then(async () => {
					toast.success("Route created");
					await utils.listRoutes.invalidate();
					onOpenChange(false);
				})
				.catch(() => {
					toast.error("Failed to create route");
				});
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>
						{mode === "create" ? "Add Route" : "Edit Route"}
					</DialogTitle>
					<DialogDescription>
						{mode === "create"
							? "Create a new routing rule for the gateway"
							: "Update the routing rule configuration"}
					</DialogDescription>
				</DialogHeader>

				<Form {...form}>
					<form
						id="hook-form-routing-rule"
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
										<Input placeholder="cloud-api-route" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>

						<div className="grid grid-cols-2 gap-4">
							<FormField
								control={form.control}
								name="host"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Host</FormLabel>
										<FormControl>
											<Input placeholder="api.hanzo.ai" {...field} />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>

							<FormField
								control={form.control}
								name="pathPrefix"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Path Prefix</FormLabel>
										<FormControl>
											<Input placeholder="/api" {...field} />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
						</div>

						<FormField
							control={form.control}
							name="backend"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Backend</FormLabel>
									<FormControl>
										<Input placeholder="cloud-api:8000" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>

						<div className="grid grid-cols-2 gap-4">
							<FormField
								control={form.control}
								name="priority"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Priority</FormLabel>
										<FormControl>
											<Input
											type="number"
											min={0}
											{...field}
											value={field.value ?? ""}
											onChange={(e) => field.onChange(e.target.value === "" ? 0 : Number(e.target.value))}
										/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>

							<FormField
								control={form.control}
								name="middlewares"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Middlewares</FormLabel>
										<FormControl>
											<Input placeholder="auth, cors" {...field} />
										</FormControl>
										<FormDescription className="text-xs">
											Comma-separated list
										</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>
						</div>

						<FormField
							control={form.control}
							name="enabled"
							render={({ field }) => (
								<FormItem className="flex items-center gap-3">
									<FormLabel className="mt-2">Enabled</FormLabel>
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
							isLoading={isSubmitting}
							form="hook-form-routing-rule"
							type="submit"
						>
							{mode === "create" ? "Create" : "Save"}
						</Button>
					</DialogFooter>
				</Form>
			</DialogContent>
		</Dialog>
	);
};

export const RoutingTable = () => {
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingRule, setEditingRule] = useState<
		(RoutingFormValues & { routingRuleId: string }) | undefined
	>(undefined);

	const { data: routes, isLoading } = gateway.listRoutes.useQuery();
	const utils = gateway.useUtils();

	const { mutateAsync: deleteMutation, isPending: isDeleting } =
		gateway.deleteRoute.useMutation();

	const handleEdit = (rule: NonNullable<typeof routes>[number]) => {
		setEditingRule({
			routingRuleId: rule.routingRuleId,
			name: rule.name,
			host: rule.host,
			pathPrefix: rule.pathPrefix ?? "",
			backend: rule.backend,
			priority: rule.priority,
			middlewares: Array.isArray(rule.middlewares)
				? rule.middlewares.join(", ")
				: "",
			enabled: rule.enabled,
		});
		setDialogOpen(true);
	};

	const handleCreate = () => {
		setEditingRule(undefined);
		setDialogOpen(true);
	};

	const handleDelete = async (routingRuleId: string) => {
		await deleteMutation({ routingRuleId })
			.then(async () => {
				toast.success("Route deleted");
				await utils.listRoutes.invalidate();
			})
			.catch(() => {
				toast.error("Failed to delete route");
			});
	};

	if (isLoading) {
		return (
			<div className="flex flex-row gap-2 items-center justify-center text-sm text-muted-foreground min-h-[20vh]">
				<span>Loading routes...</span>
				<Loader2 className="animate-spin size-4" />
			</div>
		);
	}

	return (
		<>
			<RoutingDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				defaultValues={editingRule}
				mode={editingRule ? "edit" : "create"}
			/>

			{!routes || routes.length === 0 ? (
				<div className="flex flex-col items-center gap-3 min-h-[20vh] justify-center">
					<span className="text-base text-muted-foreground text-center">
						No routing rules configured
					</span>
					<Button onClick={handleCreate}>
						<PlusIcon className="h-4 w-4" />
						Add Route
					</Button>
				</div>
			) : (
				<div className="flex flex-col gap-4">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Name</TableHead>
								<TableHead>Host</TableHead>
								<TableHead>Path</TableHead>
								<TableHead>Backend</TableHead>
								<TableHead className="text-right">Priority</TableHead>
								<TableHead>Enabled</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{routes.map((rule) => (
								<TableRow key={rule.routingRuleId}>
									<TableCell className="font-medium">{rule.name}</TableCell>
									<TableCell className="font-mono text-xs">
										{rule.host}
									</TableCell>
									<TableCell className="font-mono text-xs text-muted-foreground">
										{rule.pathPrefix || "/"}
									</TableCell>
									<TableCell className="font-mono text-xs">
										{rule.backend}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{rule.priority}
									</TableCell>
									<TableCell>
										<Badge variant={rule.enabled ? "green" : "red"}>
											{rule.enabled ? "On" : "Off"}
										</Badge>
									</TableCell>
									<TableCell className="text-right">
										<div className="flex justify-end gap-1">
											<Button
												variant="ghost"
												size="icon"
												onClick={() => handleEdit(rule)}
											>
												<Pencil className="size-4" />
											</Button>
											<DialogAction
												title="Delete Route"
												description={`Are you sure you want to delete "${rule.name}"? This action cannot be undone.`}
												type="destructive"
												onClick={() => handleDelete(rule.routingRuleId)}
											>
												<Button
													variant="ghost"
													size="icon"
													className="group hover:bg-red-500/10"
													isLoading={isDeleting}
												>
													<Trash2 className="size-4 text-primary group-hover:text-red-500" />
												</Button>
											</DialogAction>
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>

					<div className="flex justify-end">
						<Button onClick={handleCreate}>
							<PlusIcon className="h-4 w-4" />
							Add Route
						</Button>
					</div>
				</div>
			)}
		</>
	);
};
