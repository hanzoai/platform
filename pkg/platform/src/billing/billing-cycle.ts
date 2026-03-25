/**
 * Billing cycle automation: calls Commerce's batch renewal endpoint on a
 * schedule so that subscriptions are renewed and credits reset automatically.
 *
 * Commerce owns the subscription lifecycle; this module is the scheduler that
 * triggers the cycle. The Commerce endpoint is idempotent -- calling it more
 * than once for the same period is safe.
 */

const COMMERCE_URL =
  process.env.COMMERCE_URL || process.env.COMMERCE_INTERNAL_URL || "http://commerce:8001";

const COMMERCE_SERVICE_TOKEN = process.env.COMMERCE_SERVICE_TOKEN || "";

const COMMERCE_ORG = process.env.COMMERCE_SERVICE_ORG || "hanzo";

// Run the subscription cycle every hour (catch up quickly if a previous run was missed).
const CYCLE_INTERVAL_MS = 60 * 60 * 1000;

export interface CycleRunResult {
  processed: number;
  renewed: number;
  skipped: number;
  failed: number;
  errors: Array<{ subscriptionId?: string; userId?: string; error: string }>;
}

/**
 * Call Commerce POST /api/v1/billing/cycle/run to process all due
 * subscription renewals for the configured org.
 */
export async function runBillingCycle(): Promise<CycleRunResult | null> {
  if (!COMMERCE_SERVICE_TOKEN) {
    console.warn("[billing-cycle] COMMERCE_SERVICE_TOKEN not set, skipping cycle run");
    return null;
  }

  const url = `${COMMERCE_URL}/api/v1/billing/cycle/run`;
  const startedAt = Date.now();

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${COMMERCE_SERVICE_TOKEN}`,
        "X-IAM-Org": COMMERCE_ORG,
      },
      body: "{}",
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(
        `[billing-cycle] Commerce returned ${res.status}: ${body.slice(0, 500)}`
      );
      return null;
    }

    const result: CycleRunResult = await res.json();
    const elapsed = Date.now() - startedAt;

    console.log(
      `[billing-cycle] Completed in ${elapsed}ms: processed=${result.processed} renewed=${result.renewed} failed=${result.failed} skipped=${result.skipped}`
    );

    if (result.failed > 0 && result.errors.length > 0) {
      for (const err of result.errors) {
        console.error(
          `[billing-cycle] Failure: sub=${err.subscriptionId || "N/A"} user=${err.userId || "N/A"} error=${err.error}`
        );
      }
    }

    return result;
  } catch (err) {
    const elapsed = Date.now() - startedAt;
    console.error(
      `[billing-cycle] Failed after ${elapsed}ms:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Call Commerce POST /api/v1/billing/cycle/run-user for a single user.
 * Useful for manual testing or retry after a per-user failure.
 */
export async function runBillingCycleForUser(
  userId: string
): Promise<CycleRunResult | null> {
  if (!COMMERCE_SERVICE_TOKEN) {
    console.warn("[billing-cycle] COMMERCE_SERVICE_TOKEN not set, skipping cycle run");
    return null;
  }

  const url = `${COMMERCE_URL}/api/v1/billing/cycle/run-user`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${COMMERCE_SERVICE_TOKEN}`,
        "X-IAM-Org": COMMERCE_ORG,
      },
      body: JSON.stringify({ userId }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(
        `[billing-cycle] Commerce returned ${res.status} for user ${userId}: ${body.slice(0, 500)}`
      );
      return null;
    }

    return await res.json();
  } catch (err) {
    console.error(
      `[billing-cycle] Failed for user ${userId}:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

let _intervalHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Start the billing cycle scheduler. Runs immediately on first call,
 * then every CYCLE_INTERVAL_MS (default: 1 hour).
 *
 * Safe to call multiple times -- subsequent calls are no-ops.
 */
export function startBillingCycleScheduler(): void {
  if (_intervalHandle !== null) {
    return;
  }

  console.log(
    `[billing-cycle] Starting scheduler (interval=${CYCLE_INTERVAL_MS / 1000}s, commerce=${COMMERCE_URL}, org=${COMMERCE_ORG})`
  );

  // Run immediately to catch up on any missed cycles.
  void runBillingCycle();

  _intervalHandle = setInterval(() => {
    void runBillingCycle();
  }, CYCLE_INTERVAL_MS);
}

/**
 * Stop the billing cycle scheduler. Primarily for testing/graceful shutdown.
 */
export function stopBillingCycleScheduler(): void {
  if (_intervalHandle !== null) {
    clearInterval(_intervalHandle);
    _intervalHandle = null;
    console.log("[billing-cycle] Scheduler stopped");
  }
}
