import { db } from "../db";
import { organizationWallet, walletTransactions } from "../db/schema";
import { eq } from "drizzle-orm";
import { PLANS, type PlanType } from "./pricing";

export async function createOrganizationWallet(organizationId: string, ownerId: string, plan: PlanType = "hobby") {
  const planConfig = PLANS[plan];
  const cycleStart = new Date();
  const cycleEnd = new Date(cycleStart);
  cycleEnd.setDate(cycleEnd.getDate() + 30);

  const [wallet] = await db.insert(organizationWallet).values({
    organizationId,
    ownerId,
    balance: planConfig.monthlyCredits.toString(),
    monthlyCredits: planConfig.monthlyCredits.toString(),
    plan,
    cycleStart,
    cycleEnd,
  }).returning();

  await db.insert(walletTransactions).values({
    walletId: wallet!.walletId,
    organizationId,
    type: "monthly_credit",
    amount: planConfig.monthlyCredits.toString(),
    balanceBefore: "0",
    balanceAfter: planConfig.monthlyCredits.toString(),
    description: `Initial ${plan} plan credits`,
  });

  return wallet!;
}

export async function getOrganizationWallet(organizationId: string) {
  return await db.query.organizationWallet.findFirst({
    where: eq(organizationWallet.organizationId, organizationId),
  });
}

export async function getWalletBalance(organizationId: string): Promise<number> {
  const wallet = await getOrganizationWallet(organizationId);
  if (!wallet) throw new Error(`No wallet found for organization: ${organizationId}`);
  return Number(wallet.balance);
}

export async function addCreditsToWallet(
  organizationId: string,
  amount: number,
  type: "monthly_credit" | "auto_topup" | "manual_topup",
  description?: string,
  stripePaymentIntentId?: string,
) {
  const wallet = await getOrganizationWallet(organizationId);
  if (!wallet) throw new Error(`No wallet`);

  const balanceBefore = Number(wallet.balance);
  const newBalance = balanceBefore + amount;

  const [updated] = await db.update(organizationWallet)
    .set({ balance: newBalance.toString(), updatedAt: new Date() })
    .where(eq(organizationWallet.walletId, wallet.walletId))
    .returning();

  await db.insert(walletTransactions).values({
    walletId: wallet.walletId,
    organizationId,
    type,
    amount: amount.toString(),
    balanceBefore: balanceBefore.toString(),
    balanceAfter: newBalance.toString(),
    description,
    stripePaymentIntentId,
  });

  return updated!;
}

export async function deductFromWallet(
  organizationId: string,
  amount: number,
  type: "usage" | "ai_usage" | "service_fee",
  description?: string,
) {
  const wallet = await getOrganizationWallet(organizationId);
  if (!wallet) throw new Error(`No wallet`);

  const balanceBefore = Number(wallet.balance);
  if (balanceBefore < amount) throw new Error(`Insufficient balance`);

  const newBalance = balanceBefore - amount;

  const [updated] = await db.update(organizationWallet)
    .set({ balance: newBalance.toString(), updatedAt: new Date() })
    .where(eq(organizationWallet.walletId, wallet.walletId))
    .returning();

  await db.insert(walletTransactions).values({
    walletId: wallet.walletId,
    organizationId,
    type,
    amount: (-amount).toString(),
    balanceBefore: balanceBefore.toString(),
    balanceAfter: newBalance.toString(),
    description,
  });

  return updated!;
}

export async function resetMonthlyCredits(organizationId: string) {
  const wallet = await getOrganizationWallet(organizationId);
  if (!wallet) throw new Error(`No wallet`);

  const planConfig = PLANS[wallet.plan as PlanType];
  const currentBalance = Number(wallet.balance);
  const newBalance = currentBalance + planConfig.monthlyCredits;

  const cycleStart = new Date();
  const cycleEnd = new Date(cycleStart);
  cycleEnd.setDate(cycleEnd.getDate() + 30);

  const [updated] = await db.update(organizationWallet)
    .set({ balance: newBalance.toString(), cycleStart, cycleEnd, updatedAt: new Date() })
    .where(eq(organizationWallet.walletId, wallet.walletId))
    .returning();

  await db.insert(walletTransactions).values({
    walletId: wallet.walletId,
    organizationId,
    type: "monthly_credit",
    amount: planConfig.monthlyCredits.toString(),
    balanceBefore: currentBalance.toString(),
    balanceAfter: newBalance.toString(),
    description: `Monthly ${wallet.plan} plan credits`,
  });

  return updated!;
}
