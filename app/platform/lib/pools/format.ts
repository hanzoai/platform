/**
 * Pool Formatting Utilities
 *
 * Functions for formatting and parsing BigInt values,
 * percentages, and currency amounts.
 */

export function formatBigInt(value: string | bigint, decimals: number = 2): string {
  const bn = typeof value === "string" ? BigInt(value || "0") : value;
  const divisor = BigInt(10 ** 18);
  const whole = bn / divisor;
  const fraction = bn % divisor;

  if (decimals === 0) {
    return whole.toString();
  }

  const fractionStr = fraction.toString().padStart(18, "0").slice(0, decimals);
  return `${whole}.${fractionStr}`;
}

export function parseBigInt(value: string): bigint {
  if (!value || value === "") return 0n;

  const cleanValue = value.replace(/,/g, "");
  const [whole, fraction = ""] = cleanValue.split(".");
  const paddedFraction = fraction.padEnd(18, "0").slice(0, 18);

  return BigInt(whole || "0") * BigInt(10 ** 18) + BigInt(paddedFraction);
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

export function formatPercentValue(value: number): string {
  return `${value.toFixed(2)}%`;
}

export function formatUSD(value: bigint | string): string {
  const usd = Number(formatBigInt(typeof value === "string" ? value : value.toString(), 2));
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(usd);
}

export function formatNumber(value: number, decimals: number = 2): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${units[i]}`;
}

export function formatMemory(mb: number): string {
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)} GB`;
  }
  return `${mb} MB`;
}
