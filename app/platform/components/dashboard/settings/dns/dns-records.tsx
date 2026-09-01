import { Switch } from "@hanzo/ui";
import { standardSchemaResolver as zodResolver } from "@hookform/resolvers/standard-schema";
import {
	Check,
	Edit2,
	Loader2,
	PlusIcon,
	RefreshCw,
	Shield,
	Trash2,
	X,
} from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { AlertBlock } from "@/components/shared/alert-block";
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
	DialogTrigger,
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
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { dns } from "@/utils/zap-dns";

const DNS_RECORD_TYPES = [
	"A",
	"AAAA",
	"CNAME",
	"TXT",
	"MX",
	"NS",
	"SRV",
	"CAA",
] as const;

const createRecordSchema = z.object({
	type: z.enum(DNS_RECORD_TYPES),
	name: z.string().min(1, "Name is required"),
	content: z.string().min(1, "Content is required"),
	proxied: z.boolean(),
	ttl: z.number().int().positive().optional(),
});

type CreateRecordForm = z.infer<typeof createRecordSchema>;

const editRecordSchema = z.object({
	type: z.enum(DNS_RECORD_TYPES).optional(),
	name: z.string().min(1, "Name is required").optional(),
	content: z.string().min(1, "Content is required").optional(),
	proxied: z.boolean().optional(),
	ttl: z.number().int().positive().optional(),
});

type EditRecordForm = z.infer<typeof editRecordSchema>;

function formatTtl(ttl: number): string {
	if (ttl === 1) return "Auto";
	if (ttl < 60) return `${ttl}s`;
	if (ttl < 3600) return `${Math.floor(ttl / 60)}m`;
	if (ttl < 86400) return `${Math.floor(ttl / 3600)}h`;
	return `${Math.floor(ttl / 86400)}d`;
}

function AddRecordDialog({
	zoneId,
	onSuccess,
}: {
	zoneId: string;
	onSuccess: () => void;
}) {
	const [open, setOpen] = useState(false);
	const { mutateAsync, isPending } = dns.createRecord.useMutation();

	const form = useForm<CreateRecordForm>({
		defaultValues: {
			type: "A",
			name: "",
			content: "",
			proxied: false,
			ttl: 1,
		},
		resolver: zodResolver(createRecordSchema),
	});

	const onSubmit = async (data: CreateRecordForm) => {
		await mutateAsync({
			...data,
			ttl: data.ttl === 1 ? undefined : data.ttl,
			zoneId,
		})
			.then(() => {
				toast.success("DNS record created");
				form.reset();
				setOpen(false);
				onSuccess();
			})
			.catch((err: Error) => {
				toast.error(err.message || "Failed to create DNS record");
			});
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button className="w-full sm:w-auto">
					<PlusIcon className="h-4 w-4" />
					Add Record
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Add DNS Record</DialogTitle>
					<DialogDescription>
						Create a new DNS record in the selected zone
					</DialogDescription>
				</DialogHeader>
				<Form {...form}>
					<form
						id="hook-form-add-dns-record"
						onSubmit={form.handleSubmit(onSubmit)}
						className="grid w-full gap-4"
					>
						<FormField
							control={form.control}
							name="type"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Record Type</FormLabel>
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
											{DNS_RECORD_TYPES.map((type) => (
												<SelectItem key={type} value={type}>
													{type}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="name"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Name</FormLabel>
									<FormControl>
										<Input placeholder="e.g. www or @" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="content"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Content</FormLabel>
									<FormControl>
										<Input placeholder="e.g. 192.168.1.1" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="proxied"
							render={({ field }) => (
								<FormItem className="flex items-center gap-3">
									<FormLabel className="mt-1.5">Proxied</FormLabel>
									<FormControl>
										<Switch
											checked={field.value}
											onCheckedChange={field.onChange}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="ttl"
							render={({ field }) => (
								<FormItem>
									<FormLabel>TTL (1 = auto)</FormLabel>
									<FormControl>
										<Input
											type="number"
											min={1}
											{...field}
											value={field.value ?? ""}
											onChange={(e) =>
												field.onChange(
													e.target.value === "" ? 1 : Number(e.target.value),
												)
											}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
					</form>
					<DialogFooter>
						<Button
							isLoading={isPending}
							form="hook-form-add-dns-record"
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

function EditRecordDialog({
	record,
	zoneId,
	onSuccess,
}: {
	record: {
		id: string;
		type: string;
		name: string;
		content: string;
		proxied?: boolean;
		ttl?: number;
	};
	zoneId: string;
	onSuccess: () => void;
}) {
	const [open, setOpen] = useState(false);
	const { mutateAsync, isPending } = dns.updateRecord.useMutation();

	const form = useForm<EditRecordForm>({
		defaultValues: {
			type: record.type as (typeof DNS_RECORD_TYPES)[number],
			name: record.name,
			content: record.content,
			proxied: record.proxied ?? false,
			ttl: record.ttl ?? 1,
		},
		resolver: zodResolver(editRecordSchema),
	});

	const onSubmit = async (data: EditRecordForm) => {
		await mutateAsync({
			recordId: record.id,
			...data,
			ttl: data.ttl === 1 ? undefined : data.ttl,
			zoneId,
		})
			.then(() => {
				toast.success("DNS record updated");
				setOpen(false);
				onSuccess();
			})
			.catch((err: Error) => {
				toast.error(err.message || "Failed to update DNS record");
			});
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					className="group hover:bg-blue-500/10 h-11 w-11"
				>
					<Edit2 className="size-4 text-primary group-hover:text-blue-500" />
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Edit DNS Record</DialogTitle>
					<DialogDescription>
						Update the DNS record for {record.name}
					</DialogDescription>
				</DialogHeader>
				<Form {...form}>
					<form
						id={`hook-form-edit-dns-record-${record.id}`}
						onSubmit={form.handleSubmit(onSubmit)}
						className="grid w-full gap-4"
					>
						<FormField
							control={form.control}
							name="type"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Record Type</FormLabel>
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
											{DNS_RECORD_TYPES.map((type) => (
												<SelectItem key={type} value={type}>
													{type}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="name"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Name</FormLabel>
									<FormControl>
										<Input {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="content"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Content</FormLabel>
									<FormControl>
										<Input {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="proxied"
							render={({ field }) => (
								<FormItem className="flex items-center gap-3">
									<FormLabel className="mt-1.5">Proxied</FormLabel>
									<FormControl>
										<Switch
											checked={field.value}
											onCheckedChange={field.onChange}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="ttl"
							render={({ field }) => (
								<FormItem>
									<FormLabel>TTL (1 = auto)</FormLabel>
									<FormControl>
										<Input
											type="number"
											min={1}
											{...field}
											value={field.value ?? ""}
											onChange={(e) =>
												field.onChange(
													e.target.value === "" ? 1 : Number(e.target.value),
												)
											}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
					</form>
					<DialogFooter>
						<Button
							isLoading={isPending}
							form={`hook-form-edit-dns-record-${record.id}`}
							type="submit"
						>
							Save
						</Button>
					</DialogFooter>
				</Form>
			</DialogContent>
		</Dialog>
	);
}

export function DnsRecords() {
	const [selectedZoneId, setSelectedZoneId] = useState<string>("");
	const {
		data: zones,
		isLoading: zonesLoading,
		isError: zonesError,
		error: zonesErr,
		refetch: refetchZones,
	} = dns.listZones.useQuery();

	const {
		data: records,
		isLoading: recordsLoading,
		isError: recordsError,
		error: recordsErr,
		refetch: refetchRecords,
	} = dns.listRecords.useQuery(
		{ zoneId: selectedZoneId || undefined },
		{ enabled: selectedZoneId !== "" },
	);

	const { mutateAsync: deleteRecord, isPending: isDeleting } =
		dns.deleteRecord.useMutation();

	const handleDelete = async (recordId: string) => {
		await deleteRecord({ recordId, zoneId: selectedZoneId })
			.then(() => {
				toast.success("DNS record deleted");
				refetchRecords();
			})
			.catch((err: Error) => {
				toast.error(err.message || "Failed to delete DNS record");
			});
	};

	if (zonesLoading) {
		return (
			<div className="space-y-4">
				<Skeleton className="h-10 w-64" />
				<Skeleton className="h-64 w-full" />
			</div>
		);
	}

	if (zonesError) {
		return (
			<div className="space-y-4">
				<AlertBlock type="error">
					{zonesErr?.message || "Failed to load DNS zones."}
				</AlertBlock>
				<Button variant="outline" onClick={() => refetchZones()}>
					<RefreshCw className="size-4" /> Retry
				</Button>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
				<div className="w-full sm:w-64">
					<Select value={selectedZoneId} onValueChange={setSelectedZoneId}>
						<SelectTrigger>
							<SelectValue placeholder="Select a zone" />
						</SelectTrigger>
						<SelectContent>
							{zones?.map(
								(zone: { id: string; name: string; status: string }) => (
									<SelectItem key={zone.id} value={zone.id}>
										<span className="flex items-center gap-2">
											<span>{zone.name}</span>
											<Badge
												variant={zone.status === "active" ? "green" : "yellow"}
											>
												{zone.status}
											</Badge>
										</span>
									</SelectItem>
								),
							)}
						</SelectContent>
					</Select>
				</div>
				{selectedZoneId && (
					<AddRecordDialog
						zoneId={selectedZoneId}
						onSuccess={() => refetchRecords()}
					/>
				)}
			</div>

			{!selectedZoneId ? (
				<div className="flex flex-col items-center gap-3 min-h-[25vh] justify-center">
					<Shield className="size-8 text-muted-foreground" />
					<span className="text-base text-muted-foreground text-center">
						Select a zone to view DNS records
					</span>
				</div>
			) : recordsLoading ? (
				<div className="flex flex-row gap-2 items-center justify-center text-sm text-muted-foreground min-h-[25vh]">
					<span>Loading records...</span>
					<Loader2 className="animate-spin size-4" />
				</div>
			) : recordsError ? (
				<div className="flex flex-col items-center gap-3 min-h-[25vh] justify-center">
					<AlertBlock type="error">
						{recordsErr?.message || "Failed to load DNS records for this zone."}
					</AlertBlock>
					<Button variant="outline" onClick={() => refetchRecords()}>
						<RefreshCw className="size-4" /> Retry
					</Button>
				</div>
			) : !records || records.length === 0 ? (
				<div className="flex flex-col items-center gap-3 min-h-[25vh] justify-center">
					<Shield className="size-8 text-muted-foreground" />
					<span className="text-base text-muted-foreground text-center">
						No DNS records found in this zone
					</span>
				</div>
			) : (
				<div className="rounded-md border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Type</TableHead>
								<TableHead>Name</TableHead>
								<TableHead>Content</TableHead>
								<TableHead>Proxied</TableHead>
								<TableHead>TTL</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{records.map(
								(record: {
									id: string;
									type: string;
									name: string;
									content: string;
									proxied?: boolean;
									ttl?: number;
								}) => (
									<TableRow key={record.id}>
										<TableCell>
											<Badge variant="blue">{record.type}</Badge>
										</TableCell>
										<TableCell className="font-mono text-xs max-w-[200px] truncate">
											{record.name}
										</TableCell>
										<TableCell className="font-mono text-xs max-w-[250px] truncate">
											{record.content}
										</TableCell>
										<TableCell>
											{record.proxied ? (
												<Check className="size-4 text-orange-500" />
											) : (
												<X className="size-4 text-muted-foreground" />
											)}
										</TableCell>
										<TableCell>{formatTtl(record.ttl ?? 1)}</TableCell>
										<TableCell className="text-right">
											<div className="flex items-center justify-end gap-2">
												<EditRecordDialog
													record={record}
													zoneId={selectedZoneId}
													onSuccess={() => refetchRecords()}
												/>
												<DialogAction
													title="Delete DNS Record"
													description={`Are you sure you want to delete the ${record.type} record for ${record.name}?`}
													type="destructive"
													onClick={() => handleDelete(record.id)}
												>
													<Button
														variant="ghost"
														size="icon"
														className="group hover:bg-red-500/10 h-11 w-11 ml-1"
														isLoading={isDeleting}
													>
														<Trash2 className="size-4 text-primary group-hover:text-red-500" />
													</Button>
												</DialogAction>
											</div>
										</TableCell>
									</TableRow>
								),
							)}
						</TableBody>
					</Table>
				</div>
			)}
		</div>
	);
}
