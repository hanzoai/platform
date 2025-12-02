import { zodResolver } from "@hookform/resolvers/zod";
import {
	AlertCircle,
	Building2,
	Check,
	DollarSign,
	ExternalLink,
	Loader2,
	Minus,
	Plus,
	Search,
	Wallet,
	X,
} from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/utils/api";

const formatCurrency = (cents: number) => {
	return `$${(cents / 100).toFixed(2)}`;
};

const formatDate = (date: Date | string | null) => {
	if (!date) return "-";
	return new Date(date).toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
};

const addCreditsSchema = z.object({
	organizationId: z.string().min(1, "Organization is required"),
	amount: z.number().min(1, "Amount must be at least $0.01"),
	type: z.enum([
		"credit_purchase",
		"wire_transfer",
		"crypto_payment",
		"admin_adjustment",
	]),
	description: z.string().optional(),
	externalReference: z.string().optional(),
	paymentMethod: z.string().optional(),
	adminNote: z.string().optional(),
});

const deductCreditsSchema = z.object({
	organizationId: z.string().min(1, "Organization is required"),
	amount: z.number().min(1, "Amount must be at least $0.01"),
	description: z.string().min(1, "Description is required"),
});

type AddCreditsFormValues = z.infer<typeof addCreditsSchema>;
type DeductCreditsFormValues = z.infer<typeof deductCreditsSchema>;

export const AdminBilling = () => {
	const [searchQuery, setSearchQuery] = useState("");
	const [isAddCreditsOpen, setIsAddCreditsOpen] = useState(false);
	const [isDeductCreditsOpen, setIsDeductCreditsOpen] = useState(false);
	const [selectedOrg, setSelectedOrg] = useState<{
		id: string;
		name: string;
	} | null>(null);
	const [confirmPaymentId, setConfirmPaymentId] = useState<string | null>(null);

	const utils = api.useUtils();

	const { data: organizations, isLoading: orgsLoading } =
		api.organization.all.useQuery();

	const { data: billings, isLoading: billingsLoading } =
		api.billing.getAllOrganizationsBilling.useQuery({ limit: 100 });

	const { data: pendingPayments, isLoading: pendingLoading } =
		api.billing.getAllPendingPayments.useQuery();

	const addCreditsMutation = api.billing.addCredits.useMutation({
		onSuccess: (data) => {
			toast.success(
				`Added ${formatCurrency(data.transaction.amount)} credits. New balance: ${data.formattedBalance}`,
			);
			setIsAddCreditsOpen(false);
			utils.billing.getAllOrganizationsBilling.invalidate();
			addForm.reset();
		},
		onError: (error) => {
			toast.error(`Failed to add credits: ${error.message}`);
		},
	});

	const deductCreditsMutation = api.billing.deductCredits.useMutation({
		onSuccess: (data) => {
			toast.success(
				`Deducted credits. New balance: ${data.formattedBalance}`,
			);
			setIsDeductCreditsOpen(false);
			utils.billing.getAllOrganizationsBilling.invalidate();
			deductForm.reset();
		},
		onError: (error) => {
			toast.error(`Failed to deduct credits: ${error.message}`);
		},
	});

	const confirmPaymentMutation = api.billing.confirmCryptoPayment.useMutation({
		onSuccess: (data) => {
			if (data.rejected) {
				toast.info("Payment rejected");
			} else {
				toast.success(`Payment confirmed! New balance: ${data.formattedBalance}`);
			}
			setConfirmPaymentId(null);
			utils.billing.getAllPendingPayments.invalidate();
			utils.billing.getAllOrganizationsBilling.invalidate();
		},
		onError: (error) => {
			toast.error(`Failed to confirm payment: ${error.message}`);
		},
	});

	const addForm = useForm<AddCreditsFormValues>({
		resolver: zodResolver(addCreditsSchema),
		defaultValues: {
			organizationId: "",
			amount: 0,
			type: "admin_adjustment",
			description: "",
			externalReference: "",
			paymentMethod: "",
			adminNote: "",
		},
	});

	const deductForm = useForm<DeductCreditsFormValues>({
		resolver: zodResolver(deductCreditsSchema),
		defaultValues: {
			organizationId: "",
			amount: 0,
			description: "",
		},
	});

	const onAddSubmit = (values: AddCreditsFormValues) => {
		const amountInCents = Math.round(values.amount * 100);
		addCreditsMutation.mutate({
			organizationId: values.organizationId,
			amount: amountInCents,
			type: values.type,
			description: values.description,
			externalReference: values.externalReference,
			paymentMethod: values.paymentMethod,
			metadata: {
				adminNote: values.adminNote,
			},
		});
	};

	const onDeductSubmit = (values: DeductCreditsFormValues) => {
		const amountInCents = Math.round(values.amount * 100);
		deductCreditsMutation.mutate({
			organizationId: values.organizationId,
			amount: amountInCents,
			description: values.description,
		});
	};

	const openAddCreditsDialog = (orgId: string, orgName: string) => {
		setSelectedOrg({ id: orgId, name: orgName });
		addForm.setValue("organizationId", orgId);
		setIsAddCreditsOpen(true);
	};

	const openDeductCreditsDialog = (orgId: string, orgName: string) => {
		setSelectedOrg({ id: orgId, name: orgName });
		deductForm.setValue("organizationId", orgId);
		setIsDeductCreditsOpen(true);
	};

	const filteredOrganizations = organizations?.filter((org) =>
		org.name.toLowerCase().includes(searchQuery.toLowerCase()),
	);

	const billingMap = new Map(
		billings?.map((b) => [b.organizationId, b]) || [],
	);

	const getExplorerUrl = (payment: any) => {
		const metadata = payment.metadata as { network?: string; cryptoTxHash?: string };
		const txHash = metadata?.cryptoTxHash || payment.externalReference;
		if (!txHash) return null;

		switch (metadata?.network) {
			case "solana":
				return `https://solscan.io/tx/${txHash}`;
			case "base":
				return `https://basescan.org/tx/${txHash}`;
			case "ethereum":
			default:
				return `https://etherscan.io/tx/${txHash}`;
		}
	};

	return (
		<div className="w-full space-y-6">
			{/* Pending Payments Alert */}
			{(pendingPayments?.length ?? 0) > 0 && (
				<Alert className="max-w-6xl mx-auto border-yellow-500 bg-yellow-50 dark:bg-yellow-950">
					<AlertCircle className="h-4 w-4 text-yellow-600" />
					<AlertDescription className="text-yellow-800 dark:text-yellow-200">
						{pendingPayments?.length} pending crypto payment(s) awaiting confirmation
					</AlertDescription>
				</Alert>
			)}

			<Card className="bg-sidebar p-2.5 rounded-xl max-w-6xl mx-auto">
				<div className="rounded-xl bg-background shadow-md">
					<CardHeader>
						<CardTitle className="text-xl flex flex-row gap-2">
							<Wallet className="size-6 text-muted-foreground self-center" />
							Admin: Billing Management
						</CardTitle>
						<CardDescription>
							Manage organization credits, approve payments, and billing across all organizations
						</CardDescription>
					</CardHeader>
					<CardContent className="border-t pt-6">
						<Tabs defaultValue="organizations" className="w-full">
							<TabsList className="grid w-full grid-cols-2 max-w-md">
								<TabsTrigger value="organizations">Organizations</TabsTrigger>
								<TabsTrigger value="pending" className="relative">
									Pending Payments
									{(pendingPayments?.length ?? 0) > 0 && (
										<Badge variant="destructive" className="ml-2 h-5 w-5 p-0 text-xs flex items-center justify-center">
											{pendingPayments?.length}
										</Badge>
									)}
								</TabsTrigger>
							</TabsList>

							<TabsContent value="organizations" className="mt-6 space-y-4">
								{/* Search */}
								<div className="flex items-center gap-4">
									<div className="relative flex-1 max-w-sm">
										<Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
										<Input
											placeholder="Search organizations..."
											value={searchQuery}
											onChange={(e) => setSearchQuery(e.target.value)}
											className="pl-9"
										/>
									</div>
								</div>

								{/* Organizations Table */}
								{orgsLoading || billingsLoading ? (
									<div className="flex items-center justify-center py-8">
										<Loader2 className="h-6 w-6 animate-spin" />
									</div>
								) : (
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Organization</TableHead>
												<TableHead>ID</TableHead>
												<TableHead className="text-right">Credit Balance</TableHead>
												<TableHead className="text-right">Actions</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{filteredOrganizations?.map((org) => {
												const billing = billingMap.get(org.id);
												const balance = billing?.creditBalance ?? 0;
												const isLowBalance =
													billing?.lowBalanceAlertEnabled &&
													balance <= (billing?.lowBalanceThreshold ?? 10000);

												return (
													<TableRow key={org.id}>
														<TableCell>
															<div className="flex items-center gap-2">
																<Building2 className="h-4 w-4 text-muted-foreground" />
																<span className="font-medium">{org.name}</span>
															</div>
														</TableCell>
														<TableCell className="text-muted-foreground font-mono text-xs">
															{org.id}
														</TableCell>
														<TableCell className="text-right">
															<div className="flex items-center justify-end gap-2">
																<span
																	className={`font-medium ${
																		balance > 0
																			? "text-green-600"
																			: balance < 0
																				? "text-red-600"
																				: "text-muted-foreground"
																	}`}
																>
																	{formatCurrency(balance)}
																</span>
																{isLowBalance && (
																	<Badge variant="destructive" className="text-xs">
																		Low
																	</Badge>
																)}
															</div>
														</TableCell>
														<TableCell className="text-right">
															<div className="flex items-center justify-end gap-2">
																<Button
																	size="sm"
																	variant="outline"
																	onClick={() => openAddCreditsDialog(org.id, org.name)}
																>
																	<Plus className="h-4 w-4 mr-1" />
																	Credit
																</Button>
																<Button
																	size="sm"
																	variant="outline"
																	onClick={() => openDeductCreditsDialog(org.id, org.name)}
																>
																	<Minus className="h-4 w-4 mr-1" />
																	Debit
																</Button>
															</div>
														</TableCell>
													</TableRow>
												);
											})}
											{filteredOrganizations?.length === 0 && (
												<TableRow>
													<TableCell
														colSpan={4}
														className="text-center text-muted-foreground py-8"
													>
														No organizations found
													</TableCell>
												</TableRow>
											)}
										</TableBody>
									</Table>
								)}
							</TabsContent>

							<TabsContent value="pending" className="mt-6">
								{pendingLoading ? (
									<div className="flex items-center justify-center py-8">
										<Loader2 className="h-6 w-6 animate-spin" />
									</div>
								) : (pendingPayments?.length ?? 0) === 0 ? (
									<div className="text-center py-8 text-muted-foreground">
										<Check className="h-12 w-12 mx-auto mb-2 opacity-20" />
										<p>No pending payments to review</p>
									</div>
								) : (
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Date</TableHead>
												<TableHead>Organization</TableHead>
												<TableHead>Currency</TableHead>
												<TableHead>Amount</TableHead>
												<TableHead>From Address</TableHead>
												<TableHead>Tx Hash</TableHead>
												<TableHead className="text-right">Actions</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{pendingPayments?.map((payment) => {
												const metadata = payment.metadata as {
													cryptoCurrency?: string;
													fromAddress?: string;
													cryptoTxHash?: string;
												};
												const explorerUrl = getExplorerUrl(payment);

												return (
													<TableRow key={payment.id}>
														<TableCell className="text-muted-foreground text-xs">
															{formatDate(payment.createdAt)}
														</TableCell>
														<TableCell>
															<div className="flex items-center gap-2">
																<Building2 className="h-4 w-4 text-muted-foreground" />
																<span className="font-medium text-sm">
																	{(payment as any).organization?.name || "Unknown"}
																</span>
															</div>
														</TableCell>
														<TableCell>
															<Badge variant="outline">
																{metadata?.cryptoCurrency || payment.paymentMethod}
															</Badge>
														</TableCell>
														<TableCell className="font-medium">
															{formatCurrency(payment.amount)}
														</TableCell>
														<TableCell className="font-mono text-xs max-w-[100px] truncate">
															{metadata?.fromAddress || "-"}
														</TableCell>
														<TableCell>
															{explorerUrl ? (
																<Button
																	variant="link"
																	size="sm"
																	className="p-0 h-auto"
																	onClick={() => window.open(explorerUrl, "_blank")}
																>
																	<ExternalLink className="h-3 w-3 mr-1" />
																	View
																</Button>
															) : (
																<span className="text-muted-foreground text-xs">-</span>
															)}
														</TableCell>
														<TableCell className="text-right">
															<div className="flex items-center justify-end gap-2">
																<Button
																	size="sm"
																	onClick={() => confirmPaymentMutation.mutate({
																		transactionId: payment.id,
																		confirmed: true,
																	})}
																	disabled={confirmPaymentMutation.isPending}
																>
																	<Check className="h-4 w-4 mr-1" />
																	Approve
																</Button>
																<Button
																	size="sm"
																	variant="destructive"
																	onClick={() => confirmPaymentMutation.mutate({
																		transactionId: payment.id,
																		confirmed: false,
																	})}
																	disabled={confirmPaymentMutation.isPending}
																>
																	<X className="h-4 w-4 mr-1" />
																	Reject
																</Button>
															</div>
														</TableCell>
													</TableRow>
												);
											})}
										</TableBody>
									</Table>
								)}
							</TabsContent>
						</Tabs>
					</CardContent>
				</div>
			</Card>

			{/* Add Credits Dialog */}
			<Dialog open={isAddCreditsOpen} onOpenChange={setIsAddCreditsOpen}>
				<DialogContent className="sm:max-w-[500px]">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<Plus className="h-5 w-5 text-green-600" />
							Add Credits
						</DialogTitle>
						<DialogDescription>
							Add credits to {selectedOrg?.name || "organization"}
						</DialogDescription>
					</DialogHeader>

					<Form {...addForm}>
						<form onSubmit={addForm.handleSubmit(onAddSubmit)} className="space-y-4">
							<FormField
								control={addForm.control}
								name="amount"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Amount (USD)</FormLabel>
										<FormControl>
											<div className="relative">
												<span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground">
													$
												</span>
												<Input
													type="number"
													step="0.01"
													min="0.01"
													placeholder="0.00"
													className="pl-7"
													{...field}
													onChange={(e) =>
														field.onChange(parseFloat(e.target.value) || 0)
													}
												/>
											</div>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>

							<FormField
								control={addForm.control}
								name="type"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Transaction Type</FormLabel>
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
												<SelectItem value="admin_adjustment">Admin Adjustment</SelectItem>
												<SelectItem value="credit_purchase">Credit Purchase</SelectItem>
												<SelectItem value="wire_transfer">Wire Transfer</SelectItem>
												<SelectItem value="crypto_payment">Crypto Payment</SelectItem>
											</SelectContent>
										</Select>
										<FormMessage />
									</FormItem>
								)}
							/>

							<FormField
								control={addForm.control}
								name="paymentMethod"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Payment Method (Optional)</FormLabel>
										<FormControl>
											<Input placeholder="e.g., ETH, USDC, wire_usd" {...field} />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>

							<FormField
								control={addForm.control}
								name="externalReference"
								render={({ field }) => (
									<FormItem>
										<FormLabel>External Reference (Optional)</FormLabel>
										<FormControl>
											<Input
												placeholder="e.g., transaction hash, wire reference"
												{...field}
											/>
										</FormControl>
										<FormDescription>
											Crypto tx hash, wire transfer reference, etc.
										</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>

							<FormField
								control={addForm.control}
								name="description"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Description (Optional)</FormLabel>
										<FormControl>
											<Input placeholder="Description shown to customer" {...field} />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>

							<FormField
								control={addForm.control}
								name="adminNote"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Admin Note (Internal)</FormLabel>
										<FormControl>
											<Textarea placeholder="Internal notes" {...field} />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>

							<DialogFooter>
								<Button type="button" variant="outline" onClick={() => setIsAddCreditsOpen(false)}>
									Cancel
								</Button>
								<Button type="submit" disabled={addCreditsMutation.isPending}>
									{addCreditsMutation.isPending ? (
										<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									) : (
										<Plus className="mr-2 h-4 w-4" />
									)}
									Add Credits
								</Button>
							</DialogFooter>
						</form>
					</Form>
				</DialogContent>
			</Dialog>

			{/* Deduct Credits Dialog */}
			<Dialog open={isDeductCreditsOpen} onOpenChange={setIsDeductCreditsOpen}>
				<DialogContent className="sm:max-w-[400px]">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<Minus className="h-5 w-5 text-red-600" />
							Deduct Credits
						</DialogTitle>
						<DialogDescription>
							Deduct credits from {selectedOrg?.name || "organization"}
						</DialogDescription>
					</DialogHeader>

					<Form {...deductForm}>
						<form onSubmit={deductForm.handleSubmit(onDeductSubmit)} className="space-y-4">
							<FormField
								control={deductForm.control}
								name="amount"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Amount (USD)</FormLabel>
										<FormControl>
											<div className="relative">
												<span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground">
													$
												</span>
												<Input
													type="number"
													step="0.01"
													min="0.01"
													placeholder="0.00"
													className="pl-7"
													{...field}
													onChange={(e) =>
														field.onChange(parseFloat(e.target.value) || 0)
													}
												/>
											</div>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>

							<FormField
								control={deductForm.control}
								name="description"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Description (Required)</FormLabel>
										<FormControl>
											<Textarea
												placeholder="Reason for deduction (shown to customer)"
												{...field}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>

							<DialogFooter>
								<Button type="button" variant="outline" onClick={() => setIsDeductCreditsOpen(false)}>
									Cancel
								</Button>
								<Button type="submit" variant="destructive" disabled={deductCreditsMutation.isPending}>
									{deductCreditsMutation.isPending ? (
										<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									) : (
										<Minus className="mr-2 h-4 w-4" />
									)}
									Deduct Credits
								</Button>
							</DialogFooter>
						</form>
					</Form>
				</DialogContent>
			</Dialog>
		</div>
	);
};
