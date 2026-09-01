import { Switch } from "@hanzo/ui";
import { standardSchemaResolver as zodResolver } from "@hookform/resolvers/standard-schema";
import { Loader2, Pencil, PlusIcon, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { type ControllerRenderProps, useForm } from "react-hook-form";
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
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { gateway } from "@/utils/zap-gateway";

const rateLimitScopes = ["global", "org", "user", "api-key"] as const;

const rateLimitFormSchema = z.object({
	name: z.string().min(1, "Name is required"),
	scope: z.enum(rateLimitScopes),
	scopeId: z.string().optional(),
	requestsPerMinute: z.number().int().positive("Must be a positive integer"),
	burstSize: z.number().int().positive("Must be a positive integer"),
	enabled: z.boolean(),
});

type RateLimitFormValues = z.infer<typeof rateLimitFormSchema>;

type RateLimitRule = RateLimitFormValues & { rateLimitRuleId: string };

interface RateLimitDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	defaultValues?: RateLimitFormValues & { rateLimitRuleId?: string };
	mode: "create" | "edit";
}

const RateLimitDialog = ({
	open,
	onOpenChange,
	defaultValues,
	mode,
}: RateLimitDialogProps) => {
	const utils = gateway.useUtils();

	const { mutateAsync: createMutation, isPending: isCreating } =
		gateway.createRateLimit.useMutation();
	const { mutateAsync: updateMutation, isPending: isUpdating } =
		gateway.updateRateLimit.useMutation();

	const isSubmitting = isCreating || isUpdating;

	const form = useForm<RateLimitFormValues>({
		resolver: zodResolver(rateLimitFormSchema),
		defaultValues: defaultValues ?? {
			name: "",
			scope: "global",
			scopeId: "",
			requestsPerMinute: 60,
			burstSize: 10,
			enabled: true,
		},
	});

	const watchedScope = form.watch("scope");

	useEffect(() => {
		if (open && defaultValues) {
			form.reset(defaultValues);
		} else if (open) {
			form.reset({
				name: "",
				scope: "global",
				scopeId: "",
				requestsPerMinute: 60,
				burstSize: 10,
				enabled: true,
			});
		}
	}, [open, defaultValues, form]);

	const onSubmit = async (data: RateLimitFormValues) => {
		const payload = {
			...data,
			scopeId: data.scope === "global" ? undefined : data.scopeId || undefined,
		};

		if (mode === "edit" && defaultValues?.rateLimitRuleId) {
			await updateMutation({
				rateLimitRuleId: defaultValues.rateLimitRuleId,
				...payload,
			})
				.then(async () => {
					toast.success("Rate limit rule updated");
					await utils.listRateLimits.invalidate();
					onOpenChange(false);
				})
				.catch(() => {
					toast.error("Failed to update rate limit rule");
				});
		} else {
			await createMutation(payload)
				.then(async () => {
					toast.success("Rate limit rule created");
					await utils.listRateLimits.invalidate();
					onOpenChange(false);
				})
				.catch(() => {
					toast.error("Failed to create rate limit rule");
				});
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>
						{mode === "create" ? "Add Rate Limit Rule" : "Edit Rate Limit Rule"}
					</DialogTitle>
					<DialogDescription>
						{mode === "create"
							? "Create a new rate limit rule for the gateway"
							: "Update the rate limit rule configuration"}
					</DialogDescription>
				</DialogHeader>

				<Form {...form}>
					<form
						id="hook-form-rate-limit"
						onSubmit={form.handleSubmit(onSubmit)}
						className="grid w-full gap-4"
					>
						<FormField
							control={form.control}
							name="name"
							render={({
								field,
							}: {
								field: ControllerRenderProps<RateLimitFormValues, "name">;
							}) => (
								<FormItem>
									<FormLabel>Name</FormLabel>
									<FormControl>
										<Input placeholder="default-rate-limit" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>

						<FormField
							control={form.control}
							name="scope"
							render={({
								field,
							}: {
								field: ControllerRenderProps<RateLimitFormValues, "scope">;
							}) => (
								<FormItem>
									<FormLabel>Scope</FormLabel>
									<Select onValueChange={field.onChange} value={field.value}>
										<FormControl>
											<SelectTrigger>
												<SelectValue placeholder="Select scope" />
											</SelectTrigger>
										</FormControl>
										<SelectContent>
											{rateLimitScopes.map((scope) => (
												<SelectItem key={scope} value={scope}>
													{scope}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									<FormMessage />
								</FormItem>
							)}
						/>

						{watchedScope !== "global" && (
							<FormField
								control={form.control}
								name="scopeId"
								render={({
									field,
								}: {
									field: ControllerRenderProps<RateLimitFormValues, "scopeId">;
								}) => (
									<FormItem>
										<FormLabel>Scope ID</FormLabel>
										<FormControl>
											<Input
												placeholder={`Enter ${watchedScope} identifier`}
												{...field}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
						)}

						<div className="grid grid-cols-2 gap-4">
							<FormField
								control={form.control}
								name="requestsPerMinute"
								render={({
									field,
								}: {
									field: ControllerRenderProps<
										RateLimitFormValues,
										"requestsPerMinute"
									>;
								}) => (
									<FormItem>
										<FormLabel>Requests / min</FormLabel>
										<FormControl>
											<Input
												type="number"
												min={1}
												{...field}
												value={field.value ?? ""}
												onChange={(e) =>
													field.onChange(
														e.target.value === "" ? 0 : Number(e.target.value),
													)
												}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>

							<FormField
								control={form.control}
								name="burstSize"
								render={({
									field,
								}: {
									field: ControllerRenderProps<
										RateLimitFormValues,
										"burstSize"
									>;
								}) => (
									<FormItem>
										<FormLabel>Burst Size</FormLabel>
										<FormControl>
											<Input
												type="number"
												min={1}
												{...field}
												value={field.value ?? ""}
												onChange={(e) =>
													field.onChange(
														e.target.value === "" ? 0 : Number(e.target.value),
													)
												}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
						</div>

						<FormField
							control={form.control}
							name="enabled"
							render={({
								field,
							}: {
								field: ControllerRenderProps<RateLimitFormValues, "enabled">;
							}) => (
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
							form="hook-form-rate-limit"
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

export const RateLimitTable = () => {
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingRule, setEditingRule] = useState<
		(RateLimitFormValues & { rateLimitRuleId: string }) | undefined
	>(undefined);

	const { data: rateLimits, isLoading } = gateway.listRateLimits.useQuery();
	const utils = gateway.useUtils();

	const { mutateAsync: deleteMutation, isPending: isDeleting } =
		gateway.deleteRateLimit.useMutation();

	const handleEdit = (rule: NonNullable<typeof rateLimits>[number]) => {
		setEditingRule({
			rateLimitRuleId: rule.rateLimitRuleId,
			name: rule.name,
			scope: rule.scope,
			scopeId: rule.scopeId ?? "",
			requestsPerMinute: rule.requestsPerMinute,
			burstSize: rule.burstSize,
			enabled: rule.enabled,
		});
		setDialogOpen(true);
	};

	const handleCreate = () => {
		setEditingRule(undefined);
		setDialogOpen(true);
	};

	const handleDelete = async (rateLimitRuleId: string) => {
		await deleteMutation({ rateLimitRuleId })
			.then(async () => {
				toast.success("Rate limit rule deleted");
				await utils.listRateLimits.invalidate();
			})
			.catch(() => {
				toast.error("Failed to delete rate limit rule");
			});
	};

	if (isLoading) {
		return (
			<div className="flex flex-row gap-2 items-center justify-center text-sm text-muted-foreground min-h-[20vh]">
				<span>Loading rate limits...</span>
				<Loader2 className="animate-spin size-4" />
			</div>
		);
	}

	return (
		<>
			<RateLimitDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				defaultValues={editingRule}
				mode={editingRule ? "edit" : "create"}
			/>

			{!rateLimits || rateLimits.length === 0 ? (
				<div className="flex flex-col items-center gap-3 min-h-[20vh] justify-center">
					<span className="text-base text-muted-foreground text-center">
						No rate limit rules configured
					</span>
					<Button onClick={handleCreate}>
						<PlusIcon className="h-4 w-4" />
						Add Rate Limit
					</Button>
				</div>
			) : (
				<div className="flex flex-col gap-4">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Name</TableHead>
								<TableHead>Scope</TableHead>
								<TableHead>Scope ID</TableHead>
								<TableHead className="text-right">Req/min</TableHead>
								<TableHead className="text-right">Burst</TableHead>
								<TableHead>Enabled</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{rateLimits.map((rule: RateLimitRule) => (
								<TableRow key={rule.rateLimitRuleId}>
									<TableCell className="font-medium">{rule.name}</TableCell>
									<TableCell>
										<Badge variant="blank">{rule.scope}</Badge>
									</TableCell>
									<TableCell className="text-muted-foreground">
										{rule.scopeId || "--"}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{rule.requestsPerMinute}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{rule.burstSize}
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
												title="Delete Rate Limit Rule"
												description={`Are you sure you want to delete "${rule.name}"? This action cannot be undone.`}
												type="destructive"
												onClick={() => handleDelete(rule.rateLimitRuleId)}
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
							Add Rate Limit
						</Button>
					</div>
				</div>
			)}
		</>
	);
};
