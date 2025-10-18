# Billing System - Fast Rebuild & Deploy Plan

## Situation

- Built complete billing system (14 files, all metrics)
- Git reset wiped files  
- Need to get billing working at platform.hanzo.ai FAST

## What's Already Done ✅

1. ✅ `pkg/platform/src/billing/pricing.ts` - ALL rates configured
2. ✅ `pkg/platform/src/db/schema/wallet.ts` - Complete schema
3. ✅ `pkg/platform/src/db/schema/index.ts` - Exports wallet

## Fast Path to Working Billing (2 hours)

### Step 1: Use Console's Working Billing (30 min)

Console at `/work/hanzo/console` has WORKING billing with:
- Organization credits
- Stripe subscriptions
- Usage metering
- Webhooks

**Action:** Adapt console's billing for platform
- Copy console's cloudBillingRouter pattern
- Use console's webhook approach
- Leverage existing Stripe integration

### Step 2: Create Minimal Platform Integration (1 hour)

Just need:
1. Simple wallet check before deployments
2. Stripe subscription flow (copy from console)
3. Basic usage tracking (copy Docker stats pattern from console)
4. Webhook handler (adapt from console)

### Step 3: Test & Deploy (30 min)

- Test locally
- Push to production
- Verify billing works

## Execute Now

**Option A: Copy from Console** (Fastest - 1 hour)
Use console's proven billing, adapt for platform

**Option B: Recreate from Docs** (Slower - 4 hours)
Recreate all 14 files I built earlier

**Option C: Hybrid** (Medium - 2 hours)
Use console pattern + add usage tracking I designed

## Recommendation

**OPTION A** - Copy console's working billing, get it running, iterate later.

Ready to execute?
