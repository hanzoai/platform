/**
 * ZAP Platform Types -- TypeScript interfaces mirroring platform.capnp
 *
 * These types correspond 1:1 with the Cap'n Proto schema at:
 *   pkg/zap/schema/platform.capnp
 *
 * They exist so TypeScript consumers have typed interfaces for ZAP data
 * structures before capnp-ts code generation is wired up. When real
 * generated bindings land (via `capnp compile -o ts`), these should be
 * replaced or re-exported from the generated code.
 *
 * Wire protocol: Cap'n Proto binary over persistent TCP (port 9998),
 * using two-party VatNetwork RPC. This is NOT HTTP/JSON.
 *
 * Schema version: 1.0.0
 * Schema ID: @0xc8d5e9f2b3a47865
 */

// ============================================================================
// Annotations / Metadata Enums
// ============================================================================

export type Effect = "pure" | "deterministic" | "nondeterministic";

export type Scope =
  | "span"
  | "file"
  | "repo"
  | "workspace"
  | "node"
  | "chain"
  | "global";

// ============================================================================
// Common Types
// ============================================================================

export interface Timestamp {
  seconds: bigint;
  nanos: number;
}

export interface Label {
  key: string;
  value: string;
}

export interface Progress {
  done: bigint;
  total: bigint;
  message: string;
}

export interface CallContext {
  traceId: string;
  spanId: string;
  timeout: bigint;
  organizationId: string;
  authToken: string;
}

// ============================================================================
// Streaming Primitives
// ============================================================================

export interface Event {
  type: string;
  data: Uint8Array;
  timestamp: bigint;
}

/** Cap'n Proto interface -- represented as method signatures in TS. */
export interface EventStream {
  next(): Promise<{ event: Event; done: boolean }>;
  cancel(): Promise<void>;
}

export type TaskState =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface TaskStatus {
  state: TaskState;
  progress: Progress;
  startedAt: bigint;
  updatedAt: bigint;
  error: string;
}

/** Cap'n Proto interface -- represented as method signatures in TS. */
export interface Task {
  status(): Promise<TaskStatus>;
  result(): Promise<Uint8Array>;
  cancel(): Promise<void>;
  output(): Promise<EventStream>;
}

// ============================================================================
// Bootstrap Types
// ============================================================================

export interface Implementation {
  name: string;
  version: string;
}

export interface ClientCaps {
  roots: boolean;
  sampling: boolean;
  elicitation: boolean;
}

export interface EndpointCaps {
  cloud: boolean;
  scaling: boolean;
  pool: boolean;
  infra: boolean;
  deploy: boolean;
  consensus: boolean;
}

export interface Hello {
  protocolVersion: string;
  clientInfo: Implementation;
  capabilities: ClientCaps;
  organizationId: string;
}

export interface Welcome {
  protocolVersion: string;
  endpointInfo: Implementation;
  capabilities: EndpointCaps;
  instructions: string;
}

// ============================================================================
// Cloud Provider Management
// ============================================================================

export type ProviderType =
  | "digitalocean"
  | "aws"
  | "gcp"
  | "azure"
  | "hetzner"
  | "vultr"
  | "linode";

export type ProviderStatus = "active" | "inactive" | "error" | "validating";

export interface CloudProvider {
  providerId: string;
  name: string;
  slug: string;
  type: ProviderType;
  status: ProviderStatus;
  defaultRegion: string;
  defaultSize: string;
  defaultImage: string;
  organizationId: string;
  createdAt: bigint;
  lastValidated: bigint;
}

export interface ConfigureProviderRequest {
  name: string;
  slug: string;
  apiToken: string;
  type: ProviderType;
  defaultRegion: string;
  defaultSize: string;
  defaultImage: string;
}

export interface UpdateProviderRequest {
  providerId: string;
  name: string;
  apiToken: string;
  defaultRegion: string;
  defaultSize: string;
  defaultImage: string;
  isActive: boolean;
}

export interface Region {
  slug: string;
  name: string;
  available: boolean;
  sizes: string[];
}

export interface Size {
  slug: string;
  vcpus: number;
  memory: bigint;       // MB
  disk: bigint;          // GB
  priceMonthly: number;
  priceHourly: number;
  available: boolean;
  regions: string[];
}

// ============================================================================
// Scaling Operations
// ============================================================================

export type NodeType = "worker" | "manager";

export type ScaleStrategy =
  | "oldest"
  | "newest"
  | "leastUtilized"
  | "mostUtilized"
  | "specific"
  | "random";

export interface ScaleUpRequest {
  poolId: string;
  providerId: string;
  count: number;
  size: string;
  region: string;
  nodeType: NodeType;
  labels: Label[];
  userData: string;
  sshKeyIds: string[];
  enableMonitoring: boolean;
  enableBackups: boolean;
}

export interface ScaleDownRequest {
  poolId: string;
  count: number;
  strategy: ScaleStrategy;
  nodeIds: string[];
  force: boolean;
  drainTimeout: bigint;
}

export type ScalingJobType = "scaleUp" | "scaleDown" | "resize" | "migrate";

export type JobStatus =
  | "pending"
  | "inProgress"
  | "completed"
  | "failed"
  | "cancelled"
  | "partiallyCompleted";

export interface ScalingJob {
  jobId: string;
  poolId: string;
  type: ScalingJobType;
  status: JobStatus;
  targetCount: number;
  completedCount: number;
  failedCount: number;
  createdAt: bigint;
  updatedAt: bigint;
  completedAt: bigint;
  error: string;
  nodeIds: string[];
}

export interface ResizeDropletRequest {
  dropletId: string;
  newSize: string;
  resizeDisk: boolean;
}

export interface DrainNodeRequest {
  nodeId: string;
  force: boolean;
  timeout: bigint;
  gracePeriod: bigint;
}

// ============================================================================
// Node Management
// ============================================================================

export type NodeStatus =
  | "provisioning"
  | "bootstrapping"
  | "active"
  | "draining"
  | "cordoned"
  | "terminated"
  | "error"
  | "unknown";

export interface Node {
  nodeId: string;
  poolId: string;
  dropletId: string;
  status: NodeStatus;
  publicIp: string;
  privateIp: string;
  hostname: string;
  size: string;
  region: string;
  cpuUtilization: number;
  memoryUtilization: number;
  diskUtilization: number;
  networkIn: bigint;
  networkOut: bigint;
  labels: Label[];
  createdAt: bigint;
  lastHeartbeat: bigint;
}

export interface NodeStatusUpdate {
  poolId: string;
  nodes: Node[];
  timestamp: bigint;
}

// ============================================================================
// Compute Pool Management
// ============================================================================

export type PoolStatus =
  | "creating"
  | "active"
  | "scaling"
  | "updating"
  | "deleting"
  | "error";

export interface AutoScalingConfig {
  enabled: boolean;
  minNodes: number;
  maxNodes: number;
  targetCpuUtilization: number;
  targetMemoryUtilization: number;
  scaleUpCooldownSeconds: number;
  scaleDownCooldownSeconds: number;
  scaleUpThreshold: number;
  scaleDownThreshold: number;
}

export interface ComputePool {
  poolId: string;
  name: string;
  organizationId: string;
  providerId: string;
  status: PoolStatus;
  minNodes: number;
  maxNodes: number;
  currentNodes: number;
  targetNodes: number;
  autoScaling: AutoScalingConfig;
  defaultSize: string;
  defaultRegion: string;
  labels: Label[];
  createdAt: bigint;
  updatedAt: bigint;
}

export interface CreatePoolRequest {
  name: string;
  providerId: string;
  minNodes: number;
  maxNodes: number;
  defaultSize: string;
  defaultRegion: string;
  autoScaling: AutoScalingConfig;
  labels: Label[];
}

// ============================================================================
// Infrastructure Management
// ============================================================================

export interface FirewallRule {
  protocol: string;
  ports: string;
  sources: string[];
  destinations: string[];
}

export interface CreateFirewallRequest {
  providerId: string;
  poolId: string;
  name: string;
  inboundRules: FirewallRule[];
  outboundRules: FirewallRule[];
  dropletIds: string[];
  tags: string[];
}

export interface Firewall {
  firewallId: string;
  name: string;
  status: string;
  inboundRules: FirewallRule[];
  outboundRules: FirewallRule[];
  dropletIds: string[];
  tags: string[];
  createdAt: bigint;
}

export interface HealthCheck {
  protocol: string;
  port: number;
  path: string;
  checkIntervalSeconds: number;
  responseTimeoutSeconds: number;
  unhealthyThreshold: number;
  healthyThreshold: number;
}

export interface ForwardingRule {
  entryProtocol: string;
  entryPort: number;
  targetProtocol: string;
  targetPort: number;
  certificateId: string;
  tlsPassthrough: boolean;
}

export type LBAlgorithm = "roundRobin" | "leastConnections";

export interface CreateLoadBalancerRequest {
  providerId: string;
  poolId: string;
  name: string;
  region: string;
  algorithm: LBAlgorithm;
  healthCheck: HealthCheck;
  forwardingRules: ForwardingRule[];
  dropletIds: string[];
  tag: string;
  redirectHttpToHttps: boolean;
  enableProxyProtocol: boolean;
  enableBackendKeepalive: boolean;
}

export interface LoadBalancer {
  loadBalancerId: string;
  name: string;
  ip: string;
  status: string;
  algorithm: LBAlgorithm;
  region: string;
  healthCheck: HealthCheck;
  forwardingRules: ForwardingRule[];
  dropletIds: string[];
  createdAt: bigint;
}

// ============================================================================
// Application Deployment
// ============================================================================

export type ApplicationStatus =
  | "idle"
  | "running"
  | "deploying"
  | "error"
  | "stopped"
  | "restarting";

export type BuildType =
  | "dockerfile"
  | "nixpacks"
  | "buildpacks"
  | "heroku"
  | "docker"
  | "railpack";

export type SourceType =
  | "github"
  | "gitlab"
  | "bitbucket"
  | "gitea"
  | "git"
  | "dockerImage";

export interface Application {
  applicationId: string;
  name: string;
  appName: string;
  description: string;
  projectId: string;
  serverId: string;
  status: ApplicationStatus;
  buildType: BuildType;
  sourceType: SourceType;
  dockerImage: string;
  repository: string;
  branch: string;
  env: string;
  replicas: number;
  cpuLimit: string;
  memoryLimit: string;
  memoryReservation: string;
  createdAt: bigint;
  updatedAt: bigint;
}

export interface DeployRequest {
  applicationId: string;
  force: boolean;
  clearCache: boolean;
}

export interface DeployResult {
  deploymentId: string;
  status: ApplicationStatus;
  logs: string;
  startedAt: bigint;
  task: Task;
}

export interface Project {
  projectId: string;
  name: string;
  description: string;
  organizationId: string;
  env: string;
  createdAt: bigint;
}

// ============================================================================
// Tool Catalog
// ============================================================================

export type Stability = "experimental" | "beta" | "stable" | "deprecated";

export interface ToolId {
  namespace: string;
  name: string;
  version: string;
}

export interface ToolInfo {
  id: ToolId;
  description: string;
  effect: Effect;
  idempotent: boolean;
  inputSchema: Uint8Array;
  outputSchema: Uint8Array;
  stability: Stability;
}

// ============================================================================
// Cap'n Proto RPC Interfaces
//
// These represent the capability interfaces from the schema. In native
// Cap'n Proto they are object capabilities passed over the wire. Here
// they are typed as TS interfaces for documentation and bridge typing.
// ============================================================================

export interface Cloud {
  configureProvider(req: ConfigureProviderRequest, ctx: CallContext): Promise<CloudProvider>;
  updateProvider(req: UpdateProviderRequest, ctx: CallContext): Promise<CloudProvider>;
  listProviders(ctx: CallContext): Promise<CloudProvider[]>;
  getProvider(providerId: string, ctx: CallContext): Promise<CloudProvider>;
  deleteProvider(providerId: string, ctx: CallContext): Promise<boolean>;
  listRegions(providerId: string, ctx: CallContext): Promise<Region[]>;
  listSizes(providerId: string, region: string, ctx: CallContext): Promise<Size[]>;
}

export interface Scaling {
  scaleUp(req: ScaleUpRequest, ctx: CallContext): Promise<ScalingJob>;
  scaleDown(req: ScaleDownRequest, ctx: CallContext): Promise<ScalingJob>;
  resizeDroplet(req: ResizeDropletRequest, ctx: CallContext): Promise<Task>;
  drainNode(req: DrainNodeRequest, ctx: CallContext): Promise<Task>;
  getScalingJob(jobId: string, ctx: CallContext): Promise<ScalingJob>;
  listScalingJobs(poolId: string, limit: number, ctx: CallContext): Promise<ScalingJob[]>;
  cancelScalingJob(jobId: string, ctx: CallContext): Promise<boolean>;
}

export interface Pool {
  createPool(req: CreatePoolRequest, ctx: CallContext): Promise<ComputePool>;
  getPool(poolId: string, ctx: CallContext): Promise<ComputePool>;
  listPools(ctx: CallContext): Promise<ComputePool[]>;
  updatePool(poolId: string, name: string, autoScaling: AutoScalingConfig, ctx: CallContext): Promise<ComputePool>;
  deletePool(poolId: string, force: boolean, ctx: CallContext): Promise<Task>;
  listNodes(poolId: string, ctx: CallContext): Promise<Node[]>;
  getNode(nodeId: string, ctx: CallContext): Promise<Node>;
  setAutoScaling(poolId: string, config: AutoScalingConfig, ctx: CallContext): Promise<ComputePool>;
  subscribeNodeStatus(poolId: string): Promise<EventStream>;
}

export interface Infra {
  createFirewall(req: CreateFirewallRequest, ctx: CallContext): Promise<Firewall>;
  getFirewall(firewallId: string, ctx: CallContext): Promise<Firewall>;
  updateFirewall(firewallId: string, inboundRules: FirewallRule[], outboundRules: FirewallRule[], ctx: CallContext): Promise<Firewall>;
  deleteFirewall(firewallId: string, ctx: CallContext): Promise<boolean>;
  createLoadBalancer(req: CreateLoadBalancerRequest, ctx: CallContext): Promise<LoadBalancer>;
  getLoadBalancer(loadBalancerId: string, ctx: CallContext): Promise<LoadBalancer>;
  updateLoadBalancer(loadBalancerId: string, healthCheck: HealthCheck, forwardingRules: ForwardingRule[], ctx: CallContext): Promise<LoadBalancer>;
  deleteLoadBalancer(loadBalancerId: string, ctx: CallContext): Promise<boolean>;
}

export interface Deploy {
  deploy(req: DeployRequest, ctx: CallContext): Promise<DeployResult>;
  redeploy(applicationId: string, ctx: CallContext): Promise<DeployResult>;
  start(applicationId: string, ctx: CallContext): Promise<boolean>;
  stop(applicationId: string, ctx: CallContext): Promise<boolean>;
  restart(applicationId: string, ctx: CallContext): Promise<boolean>;
  getApplication(applicationId: string, ctx: CallContext): Promise<Application>;
  listApplications(projectId: string, ctx: CallContext): Promise<Application[]>;
  listProjects(ctx: CallContext): Promise<Project[]>;
  getLogs(applicationId: string, tail: number, since: bigint, ctx: CallContext): Promise<string>;
  streamLogs(applicationId: string): Promise<EventStream>;
}

/** Top-level Platform capability -- the bootstrap interface for ZAP connections. */
export interface Platform {
  initialize(hello: Hello): Promise<Welcome>;
  cloud(): Promise<Cloud>;
  scaling(): Promise<Scaling>;
  pool(): Promise<Pool>;
  infra(): Promise<Infra>;
  deploy(): Promise<Deploy>;
  ping(): Promise<{ latencyNs: bigint; serverTime: bigint }>;
  getCatalog(): Promise<ToolInfo[]>;
}
