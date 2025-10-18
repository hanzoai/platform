import { db } from "../db";
import { appUsageMetrics, aiUsageMetrics, organizationWallet } from "../db/schema";
import { eq, inArray } from "drizzle-orm";
import { deductFromWallet, resetMonthlyCredits } from "./wallet-service";
import { calculateServiceFee } from "./pricing";

export async function processUnchargedUsage() {
  const uncharged = await db.query.appUsageMetrics.findMany({ where: eq(appUsageMetrics.charged, false) });
  
  const byOrg = new Map<string, typeof uncharged>();
  for (const usage of uncharged) {
    const arr = byOrg.get(usage.organizationId) || [];
    arr.push(usage);
    byOrg.set(usage.organizationId, arr);
  }

  for (const [orgId, records] of byOrg) {
    try {
      const total = records.reduce((sum, r) => sum + Number(r.totalCost), 0);
      if (total > 0) {
        await deductFromWallet(orgId, total, "usage", `Compute usage: ${records.length} apps`);
        await db.update(appUsageMetrics)
          .set({ charged: true, chargedAt: new Date() })
          .where(inArray(appUsageMetrics.metricId, records.map(r => r.metricId)));
      }
    } catch (error) {
      console.error(`Billing error for org ${orgId}:`, error);
    }
  }
}

export async function checkBillingCycles() {
  const wallets = await db.query.organizationWallet.findMany({ where: eq(organizationWallet.subscriptionStatus, "active") });
  const now = new Date();

  for (const wallet of wallets) {
    if (wallet.cycleEnd && new Date(wallet.cycleEnd) <= now) {
      try {
        await resetMonthlyCredits(wallet.organizationId);
        console.log(`Credits reset for org ${wallet.organizationId}`);
      } catch (error) {
        console.error(`Error resetting credits for ${wallet.organizationId}:`, error);
      }
    }
  }
}

export function startBillingSchedule() {
  console.log("Starting billing schedule...");
  setInterval(() => processUnchargedUsage(), 5 * 60 * 1000);
  setInterval(() => checkBillingCycles(), 24 * 60 * 60 * 1000);
  processUnchargedUsage();
  checkBillingCycles();
}
