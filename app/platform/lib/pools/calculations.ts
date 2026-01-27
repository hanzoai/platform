/**
 * Pool Calculations
 *
 * Utility functions for calculating slippage, price impact,
 * impermanent loss, and APR.
 */

export function calculateSlippage(amount: string | bigint, slippagePercent: number): bigint {
  const bn = typeof amount === "string" ? BigInt(amount || "0") : amount;
  const slippageBps = BigInt(Math.floor(slippagePercent * 100));
  return bn - (bn * slippageBps) / 10000n;
}

export function calculatePriceImpact(
  amountIn: bigint,
  amountOut: bigint,
  spotPrice: bigint
): number {
  if (spotPrice === 0n || amountIn === 0n) return 0;

  const expectedOut = (amountIn * BigInt(10 ** 18)) / spotPrice;
  if (expectedOut === 0n) return 0;

  const impact = Number(((expectedOut - amountOut) * 10000n) / expectedOut);
  return impact / 100; // Convert to percentage
}

export function calculateImpermanentLoss(
  priceRatio: number // currentPrice / entryPrice
): number {
  // IL = 2 * sqrt(priceRatio) / (1 + priceRatio) - 1
  const sqrtRatio = Math.sqrt(priceRatio);
  return (2 * sqrtRatio) / (1 + priceRatio) - 1;
}

export function calculateAPR(
  volume24h: bigint,
  liquidity: bigint,
  feeRate: number = 0.003
): number {
  if (liquidity === 0n) return 0;

  const dailyFees = Number(volume24h) * feeRate;
  const dailyReturn = dailyFees / Number(liquidity);
  return dailyReturn * 365 * 100; // Annual percentage
}

export function calculateTotalResources(resources: {
  cpu: number;
  memory: number;
  storage: number;
  gpu?: number;
}): bigint {
  // Simplified calculation - in production this would be more complex
  return BigInt(
    resources.cpu * 10 +
      Math.floor(resources.memory / 1024) * 5 +
      Math.floor(resources.storage / 10) +
      (resources.gpu || 0) * 100
  );
}

export function calculateEstimatedCost(
  resources: { cpu: number; memory: number; storage: number; gpu?: number },
  pricePerUnit: bigint,
  hours: number = 1
): bigint {
  const totalUnits = calculateTotalResources(resources);
  return totalUnits * pricePerUnit * BigInt(hours);
}
