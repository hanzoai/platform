import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db } from "@/server/db";
import {
	creditTransaction,
	invoice,
	organizationBilling,
	paymentInstructions,
	usageRecord,
} from "@/server/db/schema";
import { adminProcedure, createTRPCRouter, protectedProcedure } from "../trpc";

export const billingRouter = createTRPCRouter({
	// Get or create organization billing record
	getOrganizationBilling: protectedProcedure
		.input(
			z.object({
				organizationId: z.string(),
			}),
		)
		.query(async ({ input }) => {
			let billing = await db.query.organizationBilling.findFirst({
				where: eq(organizationBilling.organizationId, input.organizationId),
			});

			// Auto-create billing record if it doesn't exist
			if (!billing) {
				const [newBilling] = await db
					.insert(organizationBilling)
					.values({
						organizationId: input.organizationId,
						creditBalance: 0,
					})
					.returning();
				billing = newBilling;
			}

			return billing;
		}),

	// Update organization billing settings
	updateBillingSettings: adminProcedure
		.input(
			z.object({
				organizationId: z.string(),
				billingEmail: z.string().email().optional(),
				billingName: z.string().optional(),
				billingAddress: z.string().optional(),
				preferredPaymentMethod: z.string().optional(),
				lowBalanceThreshold: z.number().optional(),
				lowBalanceAlertEnabled: z.boolean().optional(),
			}),
		)
		.mutation(async ({ input }) => {
			const { organizationId, ...updates } = input;

			const [updated] = await db
				.update(organizationBilling)
				.set({
					...updates,
					updatedAt: new Date(),
				})
				.where(eq(organizationBilling.organizationId, organizationId))
				.returning();

			return updated;
		}),

	// Get all active payment instructions (public for showing payment options)
	getPaymentInstructions: protectedProcedure.query(async () => {
		return await db.query.paymentInstructions.findMany({
			where: eq(paymentInstructions.active, true),
			orderBy: [paymentInstructions.sortOrder],
		});
	}),

	// Get credit balance
	getCreditBalance: protectedProcedure
		.input(
			z.object({
				organizationId: z.string(),
			}),
		)
		.query(async ({ input }) => {
			const billing = await db.query.organizationBilling.findFirst({
				where: eq(organizationBilling.organizationId, input.organizationId),
			});

			return {
				balance: billing?.creditBalance ?? 0,
				formattedBalance: `$${((billing?.creditBalance ?? 0) / 100).toFixed(2)}`,
			};
		}),

	// Get transaction history
	getTransactions: protectedProcedure
		.input(
			z.object({
				organizationId: z.string(),
				limit: z.number().default(50),
				offset: z.number().default(0),
			}),
		)
		.query(async ({ input }) => {
			const billing = await db.query.organizationBilling.findFirst({
				where: eq(organizationBilling.organizationId, input.organizationId),
			});

			if (!billing) {
				return { transactions: [], total: 0 };
			}

			const transactions = await db.query.creditTransaction.findMany({
				where: eq(creditTransaction.organizationBillingId, billing.id),
				orderBy: [desc(creditTransaction.createdAt)],
				limit: input.limit,
				offset: input.offset,
			});

			const [{ count }] = await db
				.select({ count: sql<number>`count(*)` })
				.from(creditTransaction)
				.where(eq(creditTransaction.organizationBillingId, billing.id));

			return {
				transactions,
				total: Number(count),
			};
		}),

	// Get usage records
	getUsageRecords: protectedProcedure
		.input(
			z.object({
				organizationId: z.string(),
				startDate: z.date().optional(),
				endDate: z.date().optional(),
				type: z
					.enum(["compute", "ai_credits", "storage", "bandwidth", "api_calls"])
					.optional(),
				limit: z.number().default(100),
				offset: z.number().default(0),
			}),
		)
		.query(async ({ input }) => {
			const billing = await db.query.organizationBilling.findFirst({
				where: eq(organizationBilling.organizationId, input.organizationId),
			});

			if (!billing) {
				return { records: [], total: 0, totalCost: 0 };
			}

			const conditions = [
				eq(usageRecord.organizationBillingId, billing.id),
			];

			if (input.startDate) {
				conditions.push(gte(usageRecord.periodStart, input.startDate));
			}
			if (input.endDate) {
				conditions.push(lte(usageRecord.periodEnd, input.endDate));
			}
			if (input.type) {
				conditions.push(eq(usageRecord.type, input.type));
			}

			const records = await db.query.usageRecord.findMany({
				where: and(...conditions),
				orderBy: [desc(usageRecord.createdAt)],
				limit: input.limit,
				offset: input.offset,
			});

			const [stats] = await db
				.select({
					count: sql<number>`count(*)`,
					totalCost: sql<number>`COALESCE(sum(total_cost), 0)`,
				})
				.from(usageRecord)
				.where(and(...conditions));

			return {
				records,
				total: Number(stats.count),
				totalCost: Number(stats.totalCost),
			};
		}),

	// Get invoices
	getInvoices: protectedProcedure
		.input(
			z.object({
				organizationId: z.string(),
				status: z
					.enum(["draft", "pending", "paid", "overdue", "cancelled"])
					.optional(),
				limit: z.number().default(20),
				offset: z.number().default(0),
			}),
		)
		.query(async ({ input }) => {
			const billing = await db.query.organizationBilling.findFirst({
				where: eq(organizationBilling.organizationId, input.organizationId),
			});

			if (!billing) {
				return { invoices: [], total: 0 };
			}

			const conditions = [eq(invoice.organizationBillingId, billing.id)];

			if (input.status) {
				conditions.push(eq(invoice.status, input.status));
			}

			const invoices = await db.query.invoice.findMany({
				where: and(...conditions),
				orderBy: [desc(invoice.createdAt)],
				limit: input.limit,
				offset: input.offset,
			});

			const [{ count }] = await db
				.select({ count: sql<number>`count(*)` })
				.from(invoice)
				.where(and(...conditions));

			return {
				invoices,
				total: Number(count),
			};
		}),

	// Get single invoice
	getInvoice: protectedProcedure
		.input(
			z.object({
				invoiceId: z.string(),
			}),
		)
		.query(async ({ input }) => {
			return await db.query.invoice.findFirst({
				where: eq(invoice.id, input.invoiceId),
			});
		}),

	// Record a pending crypto payment (user-initiated)
	recordPendingCryptoPayment: protectedProcedure
		.input(
			z.object({
				organizationId: z.string(),
				amount: z.number().positive(), // Amount in USD cents
				currency: z.string(), // ETH, USDC_ETH, USDT_ETH, USDC_BASE, USDT_BASE, SOL
				txHash: z.string(),
				fromAddress: z.string(),
			}),
		)
		.mutation(async ({ input }) => {
			// Get or create billing record
			let billing = await db.query.organizationBilling.findFirst({
				where: eq(organizationBilling.organizationId, input.organizationId),
			});

			if (!billing) {
				const [newBilling] = await db
					.insert(organizationBilling)
					.values({
						organizationId: input.organizationId,
						creditBalance: 0,
					})
					.returning();
				billing = newBilling;
			}

			// Create pending transaction record
			const [transaction] = await db
				.insert(creditTransaction)
				.values({
					organizationBillingId: billing!.id,
					type: "crypto_payment",
					status: "pending",
					amount: input.amount,
					balanceAfter: billing!.creditBalance, // Balance unchanged until confirmed
					description: `Crypto payment: ${input.currency}`,
					externalReference: input.txHash,
					paymentMethod: input.currency,
					metadata: {
						cryptoTxHash: input.txHash,
						cryptoCurrency: input.currency,
						fromAddress: input.fromAddress,
						network: input.currency.includes("BASE") ? "base" :
							input.currency.includes("ETH") || input.currency === "ETH" ? "ethereum" : "solana",
					},
				})
				.returning();

			return {
				transaction,
				message: "Payment submitted. Credits will be added once the transaction is confirmed.",
			};
		}),

	// Get pending crypto payments for user
	getPendingPayments: protectedProcedure
		.input(
			z.object({
				organizationId: z.string(),
			}),
		)
		.query(async ({ input }) => {
			const billing = await db.query.organizationBilling.findFirst({
				where: eq(organizationBilling.organizationId, input.organizationId),
			});

			if (!billing) {
				return [];
			}

			return await db.query.creditTransaction.findMany({
				where: and(
					eq(creditTransaction.organizationBillingId, billing.id),
					eq(creditTransaction.type, "crypto_payment"),
					eq(creditTransaction.status, "pending"),
				),
				orderBy: [desc(creditTransaction.createdAt)],
			});
		}),

	// ===== ADMIN PROCEDURES =====

	// Admin: Add credits to organization (manual top-up)
	addCredits: adminProcedure
		.input(
			z.object({
				organizationId: z.string(),
				amount: z.number().positive(), // Amount in cents
				type: z.enum([
					"credit_purchase",
					"wire_transfer",
					"crypto_payment",
					"admin_adjustment",
				]),
				description: z.string().optional(),
				externalReference: z.string().optional(),
				paymentMethod: z.string().optional(),
				metadata: z
					.object({
						cryptoTxHash: z.string().optional(),
						cryptoNetwork: z.string().optional(),
						cryptoAmount: z.string().optional(),
						cryptoCurrency: z.string().optional(),
						wireReference: z.string().optional(),
						wireBank: z.string().optional(),
						adminNote: z.string().optional(),
					})
					.optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			// Get or create billing record
			let billing = await db.query.organizationBilling.findFirst({
				where: eq(organizationBilling.organizationId, input.organizationId),
			});

			if (!billing) {
				const [newBilling] = await db
					.insert(organizationBilling)
					.values({
						organizationId: input.organizationId,
						creditBalance: 0,
					})
					.returning();
				billing = newBilling;
			}

			const newBalance = (billing?.creditBalance ?? 0) + input.amount;

			// Update balance
			await db
				.update(organizationBilling)
				.set({
					creditBalance: newBalance,
					updatedAt: new Date(),
				})
				.where(eq(organizationBilling.id, billing!.id));

			// Create transaction record
			const [transaction] = await db
				.insert(creditTransaction)
				.values({
					organizationBillingId: billing!.id,
					type: input.type,
					status: "completed",
					amount: input.amount,
					balanceAfter: newBalance,
					description:
						input.description || `Credit added: ${input.type.replace("_", " ")}`,
					externalReference: input.externalReference,
					paymentMethod: input.paymentMethod,
					metadata: {
						...input.metadata,
						adminUserId: ctx.user.id,
					},
					processedBy: ctx.user.id,
					processedAt: new Date(),
				})
				.returning();

			return {
				transaction,
				newBalance,
				formattedBalance: `$${(newBalance / 100).toFixed(2)}`,
			};
		}),

	// Admin: Deduct credits (for usage billing)
	deductCredits: adminProcedure
		.input(
			z.object({
				organizationId: z.string(),
				amount: z.number().positive(),
				description: z.string(),
				usageRecordId: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const billing = await db.query.organizationBilling.findFirst({
				where: eq(organizationBilling.organizationId, input.organizationId),
			});

			if (!billing) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Organization billing record not found",
				});
			}

			const newBalance = billing.creditBalance - input.amount;

			// Update balance
			await db
				.update(organizationBilling)
				.set({
					creditBalance: newBalance,
					updatedAt: new Date(),
				})
				.where(eq(organizationBilling.id, billing.id));

			// Create transaction record
			const [transaction] = await db
				.insert(creditTransaction)
				.values({
					organizationBillingId: billing.id,
					type: "usage_deduction",
					status: "completed",
					amount: -input.amount, // Negative for deductions
					balanceAfter: newBalance,
					description: input.description,
					metadata: {
						adminUserId: ctx.user.id,
					},
					processedBy: ctx.user.id,
					processedAt: new Date(),
				})
				.returning();

			return {
				transaction,
				newBalance,
				formattedBalance: `$${(newBalance / 100).toFixed(2)}`,
			};
		}),

	// Admin: Create invoice
	createInvoice: adminProcedure
		.input(
			z.object({
				organizationId: z.string(),
				periodStart: z.date(),
				periodEnd: z.date(),
				dueDate: z.date().optional(),
				notes: z.string().optional(),
			}),
		)
		.mutation(async ({ input }) => {
			const billing = await db.query.organizationBilling.findFirst({
				where: eq(organizationBilling.organizationId, input.organizationId),
			});

			if (!billing) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Organization billing record not found",
				});
			}

			// Get unbilled usage records for the period
			const unbilledUsage = await db.query.usageRecord.findMany({
				where: and(
					eq(usageRecord.organizationBillingId, billing.id),
					eq(usageRecord.billed, false),
					gte(usageRecord.periodStart, input.periodStart),
					lte(usageRecord.periodEnd, input.periodEnd),
				),
			});

			// Calculate totals
			const lineItems = unbilledUsage.map((usage) => ({
				description: `${usage.resourceName || usage.type} usage`,
				type: usage.type,
				quantity: Number(usage.quantity),
				unit: usage.unit,
				unitPrice: usage.unitPrice,
				total: usage.totalCost,
				resourceId: usage.resourceId || undefined,
			}));

			const subtotal = lineItems.reduce((sum, item) => sum + item.total, 0);
			const tax = 0; // No tax for now
			const total = subtotal + tax;

			// Generate invoice number
			const invoiceNumber = `INV-${new Date().getFullYear()}-${nanoid(8).toUpperCase()}`;

			// Create invoice
			const [newInvoice] = await db
				.insert(invoice)
				.values({
					organizationBillingId: billing.id,
					invoiceNumber,
					status: "pending",
					periodStart: input.periodStart,
					periodEnd: input.periodEnd,
					subtotal,
					tax,
					total,
					lineItems,
					dueDate: input.dueDate,
					notes: input.notes,
				})
				.returning();

			// Mark usage records as billed
			if (unbilledUsage.length > 0) {
				await db
					.update(usageRecord)
					.set({
						billed: true,
						billedAt: new Date(),
					})
					.where(
						and(
							eq(usageRecord.organizationBillingId, billing.id),
							eq(usageRecord.billed, false),
							gte(usageRecord.periodStart, input.periodStart),
							lte(usageRecord.periodEnd, input.periodEnd),
						),
					);
			}

			return newInvoice;
		}),

	// Admin: Update invoice status
	updateInvoiceStatus: adminProcedure
		.input(
			z.object({
				invoiceId: z.string(),
				status: z.enum(["draft", "pending", "paid", "overdue", "cancelled"]),
				paidAmount: z.number().optional(),
				paymentMethod: z.string().optional(),
				paymentReference: z.string().optional(),
			}),
		)
		.mutation(async ({ input }) => {
			const updates: any = {
				status: input.status,
				updatedAt: new Date(),
			};

			if (input.status === "paid") {
				updates.paidAt = new Date();
				if (input.paidAmount) updates.paidAmount = input.paidAmount;
				if (input.paymentMethod) updates.paymentMethod = input.paymentMethod;
				if (input.paymentReference)
					updates.paymentReference = input.paymentReference;
			}

			const [updated] = await db
				.update(invoice)
				.set(updates)
				.where(eq(invoice.id, input.invoiceId))
				.returning();

			return updated;
		}),

	// Admin: Record usage
	recordUsage: adminProcedure
		.input(
			z.object({
				organizationId: z.string(),
				type: z.enum([
					"compute",
					"ai_credits",
					"storage",
					"bandwidth",
					"api_calls",
				]),
				resourceId: z.string().optional(),
				resourceName: z.string().optional(),
				resourceType: z.string().optional(),
				quantity: z.number(),
				unit: z.string(),
				unitPrice: z.number(),
				periodStart: z.date(),
				periodEnd: z.date(),
				metadata: z
					.object({
						cpuHours: z.number().optional(),
						memoryGbHours: z.number().optional(),
						containerId: z.string().optional(),
						serverName: z.string().optional(),
						modelName: z.string().optional(),
						inputTokens: z.number().optional(),
						outputTokens: z.number().optional(),
						apiCalls: z.number().optional(),
						provider: z.string().optional(),
					})
					.optional(),
			}),
		)
		.mutation(async ({ input }) => {
			const billing = await db.query.organizationBilling.findFirst({
				where: eq(organizationBilling.organizationId, input.organizationId),
			});

			if (!billing) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Organization billing record not found",
				});
			}

			const totalCost = Math.round(input.quantity * input.unitPrice);

			const [record] = await db
				.insert(usageRecord)
				.values({
					organizationBillingId: billing.id,
					type: input.type,
					resourceId: input.resourceId,
					resourceName: input.resourceName,
					resourceType: input.resourceType,
					quantity: input.quantity.toString(),
					unit: input.unit,
					unitPrice: input.unitPrice,
					totalCost,
					periodStart: input.periodStart,
					periodEnd: input.periodEnd,
					metadata: input.metadata,
				})
				.returning();

			return record;
		}),

	// Admin: Get all organizations with billing (for admin dashboard)
	getAllOrganizationsBilling: adminProcedure
		.input(
			z.object({
				limit: z.number().default(50),
				offset: z.number().default(0),
			}),
		)
		.query(async ({ input }) => {
			const billings = await db.query.organizationBilling.findMany({
				orderBy: [desc(organizationBilling.creditBalance)],
				limit: input.limit,
				offset: input.offset,
				with: {
					organization: true,
				},
			});

			return billings;
		}),

	// Admin: Manage payment instructions
	createPaymentInstruction: adminProcedure
		.input(
			z.object({
				type: z.string(),
				name: z.string(),
				active: z.boolean().default(true),
				instructions: z.object({
					address: z.string().optional(),
					network: z.string().optional(),
					memo: z.string().optional(),
					qrCode: z.string().optional(),
					minAmount: z.number().optional(),
					confirmations: z.number().optional(),
					bankName: z.string().optional(),
					accountName: z.string().optional(),
					accountNumber: z.string().optional(),
					routingNumber: z.string().optional(),
					swiftCode: z.string().optional(),
					iban: z.string().optional(),
					bankAddress: z.string().optional(),
					reference: z.string().optional(),
				}),
				sortOrder: z.number().default(0),
			}),
		)
		.mutation(async ({ input }) => {
			const [instruction] = await db
				.insert(paymentInstructions)
				.values(input)
				.returning();

			return instruction;
		}),

	updatePaymentInstruction: adminProcedure
		.input(
			z.object({
				id: z.string(),
				type: z.string().optional(),
				name: z.string().optional(),
				active: z.boolean().optional(),
				instructions: z
					.object({
						address: z.string().optional(),
						network: z.string().optional(),
						memo: z.string().optional(),
						qrCode: z.string().optional(),
						minAmount: z.number().optional(),
						confirmations: z.number().optional(),
						bankName: z.string().optional(),
						accountName: z.string().optional(),
						accountNumber: z.string().optional(),
						routingNumber: z.string().optional(),
						swiftCode: z.string().optional(),
						iban: z.string().optional(),
						bankAddress: z.string().optional(),
						reference: z.string().optional(),
					})
					.optional(),
				sortOrder: z.number().optional(),
			}),
		)
		.mutation(async ({ input }) => {
			const { id, ...updates } = input;

			const [updated] = await db
				.update(paymentInstructions)
				.set({
					...updates,
					updatedAt: new Date(),
				})
				.where(eq(paymentInstructions.id, id))
				.returning();

			return updated;
		}),

	deletePaymentInstruction: adminProcedure
		.input(z.object({ id: z.string() }))
		.mutation(async ({ input }) => {
			await db
				.delete(paymentInstructions)
				.where(eq(paymentInstructions.id, input.id));
			return { success: true };
		}),

	// Admin: Confirm pending crypto payment
	confirmCryptoPayment: adminProcedure
		.input(
			z.object({
				transactionId: z.string(),
				confirmed: z.boolean(),
				adminNote: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const transaction = await db.query.creditTransaction.findFirst({
				where: eq(creditTransaction.id, input.transactionId),
			});

			if (!transaction) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Transaction not found",
				});
			}

			if (transaction.status !== "pending") {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Transaction is not pending",
				});
			}

			if (input.confirmed) {
				// Get the billing record to update balance
				const billing = await db.query.organizationBilling.findFirst({
					where: eq(organizationBilling.id, transaction.organizationBillingId),
				});

				if (!billing) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Billing record not found",
					});
				}

				const newBalance = billing.creditBalance + transaction.amount;

				// Update balance
				await db
					.update(organizationBilling)
					.set({
						creditBalance: newBalance,
						updatedAt: new Date(),
					})
					.where(eq(organizationBilling.id, billing.id));

				// Update transaction
				await db
					.update(creditTransaction)
					.set({
						status: "completed",
						balanceAfter: newBalance,
						processedBy: ctx.user.id,
						processedAt: new Date(),
						metadata: {
							...(transaction.metadata as object),
							adminNote: input.adminNote,
							confirmedBy: ctx.user.id,
						},
					})
					.where(eq(creditTransaction.id, input.transactionId));

				return {
					success: true,
					newBalance,
					formattedBalance: `$${(newBalance / 100).toFixed(2)}`,
				};
			} else {
				// Reject the payment
				await db
					.update(creditTransaction)
					.set({
						status: "failed",
						processedBy: ctx.user.id,
						processedAt: new Date(),
						metadata: {
							...(transaction.metadata as object),
							adminNote: input.adminNote,
							rejectedBy: ctx.user.id,
						},
					})
					.where(eq(creditTransaction.id, input.transactionId));

				return {
					success: true,
					rejected: true,
				};
			}
		}),

	// Admin: Get all pending crypto payments
	getAllPendingPayments: adminProcedure.query(async () => {
		const pendingPayments = await db.query.creditTransaction.findMany({
			where: and(
				eq(creditTransaction.type, "crypto_payment"),
				eq(creditTransaction.status, "pending"),
			),
			orderBy: [desc(creditTransaction.createdAt)],
		});

		// Get organization info for each payment
		const paymentsWithOrg = await Promise.all(
			pendingPayments.map(async (payment) => {
				const billing = await db.query.organizationBilling.findFirst({
					where: eq(organizationBilling.id, payment.organizationBillingId),
					with: {
						organization: true,
					},
				});
				return {
					...payment,
					organization: billing?.organization,
				};
			}),
		);

		return paymentsWithOrg;
	}),
});
