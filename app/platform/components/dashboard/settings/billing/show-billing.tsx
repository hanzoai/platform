import {
	AlertTriangle,
	Bitcoin,
	Building2,
	Clock,
	Copy,
	CreditCard,
	DollarSign,
	FileText,
	History,
	Loader2,
	Mail,
	Receipt,
	Wallet,
	Zap,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
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
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { api } from "@/utils/api";
import { CryptoPayment } from "./crypto-payment";

const formatCurrency = (cents: number) => {
	return `$${(cents / 100).toFixed(2)}`;
};

const formatDate = (date: Date | string | null) => {
	if (!date) return "-";
	return new Date(date).toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
};

const CopyButton = ({ text }: { text: string }) => {
	const handleCopy = async () => {
		await navigator.clipboard.writeText(text);
		toast.success("Copied to clipboard");
	};

	return (
		<Button variant="ghost" size="icon" onClick={handleCopy} className="h-6 w-6">
			<Copy className="h-3 w-3" />
		</Button>
	);
};

const TransactionStatusBadge = ({ status }: { status: string }) => {
	const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
		completed: "default",
		pending: "secondary",
		failed: "destructive",
		cancelled: "outline",
	};

	return (
		<Badge variant={variants[status] || "outline"} className="capitalize">
			{status}
		</Badge>
	);
};

const InvoiceStatusBadge = ({ status }: { status: string }) => {
	const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
		paid: "default",
		pending: "secondary",
		overdue: "destructive",
		draft: "outline",
		cancelled: "outline",
	};

	return (
		<Badge variant={variants[status] || "outline"} className="capitalize">
			{status}
		</Badge>
	);
};

export const ShowBilling = () => {
	const { data: user } = api.user.get.useQuery();
	const organizationId = user?.session?.activeOrganizationId;

	const { data: billing, isLoading: billingLoading } =
		api.billing.getOrganizationBilling.useQuery(
			{ organizationId: organizationId! },
			{ enabled: !!organizationId },
		);

	const { data: balance } = api.billing.getCreditBalance.useQuery(
		{ organizationId: organizationId! },
		{ enabled: !!organizationId },
	);

	const { data: paymentInstructions, isLoading: paymentsLoading } =
		api.billing.getPaymentInstructions.useQuery();

	const { data: transactionsData, isLoading: transactionsLoading } =
		api.billing.getTransactions.useQuery(
			{ organizationId: organizationId!, limit: 20 },
			{ enabled: !!organizationId },
		);

	const { data: usageData } = api.billing.getUsageRecords.useQuery(
		{ organizationId: organizationId!, limit: 50 },
		{ enabled: !!organizationId },
	);

	const { data: invoicesData } = api.billing.getInvoices.useQuery(
		{ organizationId: organizationId!, limit: 10 },
		{ enabled: !!organizationId },
	);

	const cryptoInstructions = paymentInstructions?.filter((p) =>
		p.type.startsWith("crypto"),
	);
	const wireInstructions = paymentInstructions?.filter((p) =>
		p.type.startsWith("wire"),
	);
	const zelleInstructions = paymentInstructions?.filter((p) =>
		p.type === "zelle",
	);

	const isLowBalance =
		billing?.lowBalanceAlertEnabled &&
		(billing?.creditBalance ?? 0) <= (billing?.lowBalanceThreshold ?? 10000);

	if (billingLoading) {
		return (
			<div className="flex items-center justify-center min-h-[40vh]">
				<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
			</div>
		);
	}

	return (
		<div className="w-full space-y-6">
			{/* Credit Balance Card */}
			<Card className="bg-sidebar p-2.5 rounded-xl max-w-5xl mx-auto">
				<div className="rounded-xl bg-background shadow-md">
					<CardHeader>
						<CardTitle className="text-xl flex flex-row gap-2">
							<Wallet className="size-6 text-muted-foreground self-center" />
							Credit Balance
						</CardTitle>
						<CardDescription>
							Your prepaid credit balance for compute and AI services
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4 border-t pt-6">
						<div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
							<div>
								<p className="text-sm text-muted-foreground">Available Credits</p>
								<p className="text-4xl font-bold text-primary">
									{balance?.formattedBalance || "$0.00"}
								</p>
							</div>
							{isLowBalance && (
								<div className="flex flex-row gap-2 p-3 bg-yellow-50 dark:bg-yellow-950 rounded-lg items-center">
									<AlertTriangle className="text-yellow-600 dark:text-yellow-400 h-5 w-5" />
									<span className="text-sm text-yellow-600 dark:text-yellow-400">
										Low balance! Consider adding credits to avoid service interruption.
									</span>
								</div>
							)}
						</div>
					</CardContent>
				</div>
			</Card>

			{/* Payment Instructions */}
			<Card className="bg-sidebar p-2.5 rounded-xl max-w-5xl mx-auto">
				<div className="rounded-xl bg-background shadow-md">
					<CardHeader>
						<CardTitle className="text-xl flex flex-row gap-2">
							<CreditCard className="size-6 text-muted-foreground self-center" />
							Add Credits
						</CardTitle>
						<CardDescription>
							Top up your account using crypto or wire transfer
						</CardDescription>
					</CardHeader>
					<CardContent className="border-t pt-6">
						{paymentsLoading ? (
							<div className="flex items-center justify-center py-8">
								<Loader2 className="h-6 w-6 animate-spin" />
							</div>
						) : (
							<Tabs defaultValue="wallet" className="w-full">
								<TabsList className="grid w-full grid-cols-4 max-w-2xl">
									<TabsTrigger value="wallet" className="gap-2">
										<Zap className="h-4 w-4" />
										Connect Wallet
									</TabsTrigger>
									<TabsTrigger value="zelle" className="gap-2">
										<Mail className="h-4 w-4" />
										Zelle
									</TabsTrigger>
									<TabsTrigger value="crypto" className="gap-2">
										<Bitcoin className="h-4 w-4" />
										Manual Crypto
									</TabsTrigger>
									<TabsTrigger value="wire" className="gap-2">
										<Building2 className="h-4 w-4" />
										Wire Transfer
									</TabsTrigger>
								</TabsList>

								<TabsContent value="wallet" className="mt-6">
									<CryptoPayment
										organizationId={organizationId!}
										onPaymentComplete={() => {
											// Refetch billing data after payment
										}}
									/>
								</TabsContent>

								<TabsContent value="zelle" className="mt-6 space-y-4">
									<div className="p-4 border rounded-lg space-y-4">
										<div className="flex items-center justify-between">
											<h4 className="font-medium text-lg">Pay with Zelle</h4>
											<Badge variant="default" className="bg-green-600">
												<Clock className="h-3 w-3 mr-1" />
												~1 Hour Processing
											</Badge>
										</div>
										<p className="text-sm text-muted-foreground">
											Zelle is the fastest way to add credits to your account. Funds typically arrive within 1 hour.
										</p>
										<div className="bg-muted p-4 rounded-md space-y-3">
											<div className="flex items-center justify-between">
												<span className="text-sm text-muted-foreground">Send to:</span>
												<div className="flex items-center gap-2">
													<span className="font-medium text-lg">payments@hanzo.ai</span>
													<CopyButton text="payments@hanzo.ai" />
												</div>
											</div>
										</div>
										<div className="bg-blue-50 dark:bg-blue-950 p-3 rounded-md">
											<p className="text-sm text-blue-700 dark:text-blue-300">
												<strong>Important:</strong> Include your Organization ID in the Zelle memo: <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">{organizationId}</code>
											</p>
										</div>
										<div className="text-xs text-muted-foreground space-y-1">
											<p>• Send from your bank's Zelle feature or the Zelle app</p>
											<p>• Credits are added manually after verification</p>
											<p>• Contact support if credits aren't added within 2 hours</p>
										</div>
									</div>
								</TabsContent>

								<TabsContent value="crypto" className="mt-6 space-y-4">
									<p className="text-sm text-muted-foreground">
										Prefer to send manually? Use one of the addresses below. Credits will be
										added to your account after the transaction is confirmed.
									</p>
									<div className="grid gap-4">
										{cryptoInstructions?.map((instruction) => {
											const instr = instruction.instructions as {
												address?: string;
												network?: string;
												confirmations?: number;
												minAmount?: number;
											};
											return (
												<div
													key={instruction.id}
													className="p-4 border rounded-lg space-y-3"
												>
													<div className="flex items-center justify-between">
														<h4 className="font-medium">{instruction.name}</h4>
														{instr.network && (
															<Badge variant="outline">{instr.network}</Badge>
														)}
													</div>
													{instr.address && (
														<div className="flex items-center gap-2 bg-muted p-3 rounded-md">
															<code className="text-xs flex-1 break-all">
																{instr.address}
															</code>
															<CopyButton text={instr.address} />
														</div>
													)}
													<div className="flex gap-4 text-xs text-muted-foreground">
														{instr.minAmount && (
															<span>Min: ${instr.minAmount}</span>
														)}
														{instr.confirmations && (
															<span>Confirmations: {instr.confirmations}</span>
														)}
													</div>
												</div>
											);
										})}
									</div>
									<p className="text-xs text-muted-foreground mt-4">
										Please include your organization ID ({organizationId}) in the
										transaction memo/reference when possible for faster processing.
									</p>
								</TabsContent>

								<TabsContent value="wire" className="mt-6 space-y-4">
									<div className="flex items-center justify-between mb-2">
										<p className="text-sm text-muted-foreground">
											Send a wire transfer to the bank account below.
										</p>
										<Badge variant="secondary">
											<Clock className="h-3 w-3 mr-1" />
											24hrs / Same Day before 2pm
										</Badge>
									</div>
									<div className="bg-amber-50 dark:bg-amber-950 p-3 rounded-md mb-4">
										<p className="text-sm text-amber-700 dark:text-amber-300">
											<strong>Processing Time:</strong> Wire transfers typically process within 24 hours.
											Same-day processing available for wires initiated before 2pm PT.
										</p>
									</div>
									{wireInstructions?.map((instruction) => {
										const instr = instruction.instructions as {
											bankName?: string;
											accountName?: string;
											accountNumber?: string;
											routingNumber?: string;
											swiftCode?: string;
											iban?: string;
											bankAddress?: string;
											reference?: string;
										};
										return (
											<div
												key={instruction.id}
												className="p-4 border rounded-lg space-y-4"
											>
												<h4 className="font-medium">{instruction.name}</h4>
												<div className="grid gap-3 text-sm">
													{instr.bankName && (
														<div className="flex justify-between">
															<span className="text-muted-foreground">Bank Name</span>
															<div className="flex items-center gap-2">
																<span className="font-medium">{instr.bankName}</span>
																<CopyButton text={instr.bankName} />
															</div>
														</div>
													)}
													{instr.accountName && (
														<div className="flex justify-between">
															<span className="text-muted-foreground">
																Account Name
															</span>
															<div className="flex items-center gap-2">
																<span className="font-medium">{instr.accountName}</span>
																<CopyButton text={instr.accountName} />
															</div>
														</div>
													)}
													{instr.accountNumber && (
														<div className="flex justify-between">
															<span className="text-muted-foreground">
																Account Number
															</span>
															<div className="flex items-center gap-2">
																<span className="font-medium">
																	{instr.accountNumber}
																</span>
																<CopyButton text={instr.accountNumber} />
															</div>
														</div>
													)}
													{instr.routingNumber && (
														<div className="flex justify-between">
															<span className="text-muted-foreground">
																Routing Number
															</span>
															<div className="flex items-center gap-2">
																<span className="font-medium">
																	{instr.routingNumber}
																</span>
																<CopyButton text={instr.routingNumber} />
															</div>
														</div>
													)}
													{instr.swiftCode && (
														<div className="flex justify-between">
															<span className="text-muted-foreground">SWIFT Code</span>
															<div className="flex items-center gap-2">
																<span className="font-medium">{instr.swiftCode}</span>
																<CopyButton text={instr.swiftCode} />
															</div>
														</div>
													)}
													{instr.iban && (
														<div className="flex justify-between">
															<span className="text-muted-foreground">IBAN</span>
															<div className="flex items-center gap-2">
																<span className="font-medium">{instr.iban}</span>
																<CopyButton text={instr.iban} />
															</div>
														</div>
													)}
													{instr.bankAddress && (
														<div className="flex justify-between">
															<span className="text-muted-foreground">
																Bank Address
															</span>
															<span className="font-medium text-right max-w-[200px]">
																{instr.bankAddress}
															</span>
														</div>
													)}
												</div>
												{instr.reference && (
													<div className="bg-muted p-3 rounded-md">
														<p className="text-xs text-muted-foreground">
															Reference Instructions
														</p>
														<p className="text-sm font-medium">{instr.reference}</p>
														<p className="text-xs text-muted-foreground mt-1">
															Include your Organization ID: {organizationId}
														</p>
													</div>
												)}
											</div>
										);
									})}
								</TabsContent>
							</Tabs>
						)}
					</CardContent>
				</div>
			</Card>

			{/* Transaction History */}
			<Card className="bg-sidebar p-2.5 rounded-xl max-w-5xl mx-auto">
				<div className="rounded-xl bg-background shadow-md">
					<CardHeader>
						<CardTitle className="text-xl flex flex-row gap-2">
							<History className="size-6 text-muted-foreground self-center" />
							Transaction History
						</CardTitle>
						<CardDescription>
							Your credit purchases and usage deductions
						</CardDescription>
					</CardHeader>
					<CardContent className="border-t pt-6">
						{transactionsLoading ? (
							<div className="flex items-center justify-center py-8">
								<Loader2 className="h-6 w-6 animate-spin" />
							</div>
						) : transactionsData?.transactions.length === 0 ? (
							<div className="text-center py-8 text-muted-foreground">
								<DollarSign className="h-12 w-12 mx-auto mb-2 opacity-20" />
								<p>No transactions yet</p>
							</div>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Date</TableHead>
										<TableHead>Type</TableHead>
										<TableHead>Description</TableHead>
										<TableHead>Status</TableHead>
										<TableHead className="text-right">Amount</TableHead>
										<TableHead className="text-right">Balance</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{transactionsData?.transactions.map((tx) => (
										<TableRow key={tx.id}>
											<TableCell className="text-muted-foreground">
												{formatDate(tx.createdAt)}
											</TableCell>
											<TableCell className="capitalize">
												{tx.type.replace(/_/g, " ")}
											</TableCell>
											<TableCell className="max-w-[200px] truncate">
												{tx.description || "-"}
											</TableCell>
											<TableCell>
												<TransactionStatusBadge status={tx.status} />
											</TableCell>
											<TableCell
												className={cn(
													"text-right font-medium",
													tx.amount >= 0 ? "text-green-600" : "text-red-600",
												)}
											>
												{tx.amount >= 0 ? "+" : ""}
												{formatCurrency(tx.amount)}
											</TableCell>
											<TableCell className="text-right text-muted-foreground">
												{tx.balanceAfter !== null
													? formatCurrency(tx.balanceAfter)
													: "-"}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						)}
					</CardContent>
				</div>
			</Card>

			{/* Usage Records */}
			<Card className="bg-sidebar p-2.5 rounded-xl max-w-5xl mx-auto">
				<div className="rounded-xl bg-background shadow-md">
					<CardHeader>
						<CardTitle className="text-xl flex flex-row gap-2">
							<Clock className="size-6 text-muted-foreground self-center" />
							Usage Records
						</CardTitle>
						<CardDescription>
							Detailed breakdown of your compute and AI usage
						</CardDescription>
					</CardHeader>
					<CardContent className="border-t pt-6">
						{usageData?.records.length === 0 ? (
							<div className="text-center py-8 text-muted-foreground">
								<Receipt className="h-12 w-12 mx-auto mb-2 opacity-20" />
								<p>No usage records yet</p>
							</div>
						) : (
							<>
								<div className="flex justify-between items-center mb-4">
									<p className="text-sm text-muted-foreground">
										{usageData?.total || 0} records
									</p>
									<p className="text-sm font-medium">
										Total: {formatCurrency(usageData?.totalCost || 0)}
									</p>
								</div>
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Period</TableHead>
											<TableHead>Type</TableHead>
											<TableHead>Resource</TableHead>
											<TableHead className="text-right">Quantity</TableHead>
											<TableHead className="text-right">Cost</TableHead>
											<TableHead>Billed</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{usageData?.records.map((record) => (
											<TableRow key={record.id}>
												<TableCell className="text-muted-foreground text-xs">
													{formatDate(record.periodStart)} -{" "}
													{formatDate(record.periodEnd)}
												</TableCell>
												<TableCell className="capitalize">
													{record.type.replace(/_/g, " ")}
												</TableCell>
												<TableCell>
													{record.resourceName || record.resourceType || "-"}
												</TableCell>
												<TableCell className="text-right">
													{Number(record.quantity).toFixed(2)} {record.unit}
												</TableCell>
												<TableCell className="text-right font-medium">
													{formatCurrency(record.totalCost)}
												</TableCell>
												<TableCell>
													<Badge variant={record.billed ? "default" : "secondary"}>
														{record.billed ? "Yes" : "No"}
													</Badge>
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</>
						)}
					</CardContent>
				</div>
			</Card>

			{/* Invoices */}
			<Card className="bg-sidebar p-2.5 rounded-xl max-w-5xl mx-auto">
				<div className="rounded-xl bg-background shadow-md">
					<CardHeader>
						<CardTitle className="text-xl flex flex-row gap-2">
							<FileText className="size-6 text-muted-foreground self-center" />
							Invoices
						</CardTitle>
						<CardDescription>Your billing invoices and statements</CardDescription>
					</CardHeader>
					<CardContent className="border-t pt-6">
						{invoicesData?.invoices.length === 0 ? (
							<div className="text-center py-8 text-muted-foreground">
								<FileText className="h-12 w-12 mx-auto mb-2 opacity-20" />
								<p>No invoices yet</p>
							</div>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Invoice #</TableHead>
										<TableHead>Period</TableHead>
										<TableHead>Status</TableHead>
										<TableHead className="text-right">Total</TableHead>
										<TableHead>Due Date</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{invoicesData?.invoices.map((inv) => (
										<TableRow key={inv.id}>
											<TableCell className="font-medium">
												{inv.invoiceNumber}
											</TableCell>
											<TableCell className="text-muted-foreground text-xs">
												{formatDate(inv.periodStart)} - {formatDate(inv.periodEnd)}
											</TableCell>
											<TableCell>
												<InvoiceStatusBadge status={inv.status} />
											</TableCell>
											<TableCell className="text-right font-medium">
												{formatCurrency(inv.total)}
											</TableCell>
											<TableCell className="text-muted-foreground">
												{formatDate(inv.dueDate)}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						)}
					</CardContent>
				</div>
			</Card>

			{/* Support */}
			<Card className="bg-sidebar p-2.5 rounded-xl max-w-5xl mx-auto">
				<div className="rounded-xl bg-background shadow-md">
					<CardHeader>
						<CardTitle className="text-lg">Need Help?</CardTitle>
						<CardDescription>
							Questions about billing or payments? We're here to help.
						</CardDescription>
					</CardHeader>
					<CardContent className="border-t pt-6">
						<div className="flex flex-col sm:flex-row gap-4">
							<Button
								className="rounded-full bg-[#5965F2] hover:bg-[#4A55E0]"
								asChild
							>
								<Link
									href="https://discord.gg/XthHQQj"
									target="_blank"
									className="flex flex-row items-center gap-2 text-white"
								>
									<svg
										role="img"
										className="h-5 w-5 fill-white"
										viewBox="0 0 24 24"
										xmlns="http://www.w3.org/2000/svg"
									>
										<path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
									</svg>
									Join Discord
								</Link>
							</Button>
							<Button variant="outline" asChild>
								<Link href="mailto:support@hanzo.ai">Contact Support</Link>
							</Button>
						</div>
					</CardContent>
				</div>
			</Card>
		</div>
	);
};
