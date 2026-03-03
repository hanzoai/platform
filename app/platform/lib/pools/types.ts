/**
 * Pool Types and Interfaces
 *
 * Type definitions for compute pools, liquidity positions,
 * order book entries, and swap quotes.
 */

export enum ResourceType {
  CPU = 0,
  GPU = 1,
  Memory = 2,
  Storage = 3,
  Bandwidth = 4,
  WASM = 5,
  Docker = 6,
  K8S = 7,
}

export const ResourceTypeLabels: Record<ResourceType, string> = {
  [ResourceType.CPU]: "CPU",
  [ResourceType.GPU]: "GPU",
  [ResourceType.Memory]: "Memory",
  [ResourceType.Storage]: "Storage",
  [ResourceType.Bandwidth]: "Bandwidth",
  [ResourceType.WASM]: "WASM",
  [ResourceType.Docker]: "Docker",
  [ResourceType.K8S]: "K8S",
};

export interface Pool {
  id: string;
  name: string;
  resourceType: ResourceType;
  resourceAmount: string;
  tokenAmount: string;
  totalLiquidity: string;
  feeRate: number;
  utilization: number;
  lastPrice: string;
  volume24h: string;
  priceChange24h: number;
  avgSlaScore: number;
  apr: number;
  region?: string;
  nodeCount?: number;
  status?: "active" | "paused" | "draining";
}

export interface PoolNode {
  id: string;
  poolId: string;
  name: string;
  status: "online" | "offline" | "maintenance";
  specs: NodeSpecs;
  availability: number;
  performanceScore: number;
  lastSeen: Date;
  region: string;
  provider?: string;
}

export interface NodeSpecs {
  cpu: {
    cores: number;
    model: string;
    frequency?: number;
  };
  memory: {
    total: number;
    available: number;
  };
  storage: {
    total: number;
    available: number;
    type: "ssd" | "nvme" | "hdd";
  };
  gpu?: {
    model: string;
    memory: number;
    count: number;
  };
  network: {
    bandwidth: number;
    latency?: number;
  };
}

export interface LiquidityPosition {
  poolId: string;
  resourceType: ResourceType;
  liquidityShares: string;
  resourceAmount: string;
  tokenAmount: string;
  pendingRewards: string;
  entryPrice: string;
  impermanentLoss: number;
}

export interface OrderBookEntry {
  orderId: string;
  provider: string;
  resourceType: ResourceType;
  amount: string;
  pricePerUnit: string;
  duration: number;
  slaScore: number;
  attestation?: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface SwapQuote {
  expectedOutput: string;
  priceImpact: number;
  tradingFee: string;
  useAMM: boolean;
  minOutput: string;
}

export interface ComputeOffer {
  id: string;
  poolId: string;
  nodeId: string;
  resourceType: ResourceType;
  pricePerUnit: string;
  minUnits: number;
  maxUnits: number;
  duration: number;
  slaGuarantee: number;
  status: "active" | "filled" | "expired" | "cancelled";
  createdAt: Date;
  expiresAt: Date;
}

export interface ResourceRequirements {
  cpu: number;
  memory: number;
  storage: number;
  gpu?: number;
}

export interface Budget {
  maxTokensPerHour: string;
  maxTotalTokens: string;
}
