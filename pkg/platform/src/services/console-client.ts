/**
 * Console client for fetching observability metrics from console.hanzo.ai.
 *
 * Auth: HTTP Basic with CONSOLE_PUBLIC_KEY:CONSOLE_SECRET_KEY
 * Endpoint: GET /api/public/metrics/daily
 */

const CONSOLE_API_URL =
  process.env.CONSOLE_API_URL || "https://console.hanzo.ai";
const CONSOLE_PUBLIC_KEY = process.env.CONSOLE_PUBLIC_KEY || "";
const CONSOLE_SECRET_KEY = process.env.CONSOLE_SECRET_KEY || "";

export interface DailyMetrics {
  date: string;
  totalTraces: number;
  totalObservations: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  modelUsage: Array<{
    model: string;
    tokens: number;
    cost: number;
    count: number;
  }>;
}

function getAuthHeader(): string {
  if (!CONSOLE_PUBLIC_KEY || !CONSOLE_SECRET_KEY) return "";
  const encoded = Buffer.from(
    `${CONSOLE_PUBLIC_KEY}:${CONSOLE_SECRET_KEY}`,
  ).toString("base64");
  return `Basic ${encoded}`;
}

function isConfigured(): boolean {
  return Boolean(CONSOLE_PUBLIC_KEY && CONSOLE_SECRET_KEY);
}

export async function fetchDailyMetrics(): Promise<DailyMetrics | null> {
  if (!isConfigured()) return null;

  const auth = getAuthHeader();
  const url = `${CONSOLE_API_URL}/api/public/metrics/daily`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: auth } : {}),
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    console.warn(`Console metrics fetch failed: ${res.status} ${res.statusText}`);
    return null;
  }

  return res.json() as Promise<DailyMetrics>;
}

export { isConfigured as isConsoleConfigured, CONSOLE_API_URL };
