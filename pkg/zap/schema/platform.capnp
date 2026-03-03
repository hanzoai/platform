@0xc8d5e9f2b3a47865;

# ============================================================================
# Hanzo Platform ZAP Schema
# ============================================================================
#
# Cap'n Proto schema for Platform ZAP interface.
# Enables high-performance agent control of cloud infrastructure.
#
# Version: 1.0.0
# Profile: zap-capnp-1
#
# Build: capnp compile -o rust:src/gen platform.capnp
# ============================================================================

# ============================================================================
# Annotations (from base ZAP schema)
# ============================================================================

annotation methodEffect @0xa1b2c3d4e5f6a7bc (method) :Effect;
annotation idempotent @0xa1b2c3d4e5f6a7bd (method) :Bool;
annotation methodScope @0xa1b2c3d4e5f6a7bf (method) :Scope;

enum Effect {
    pure @0;
    deterministic @1;
    nondeterministic @2;
}

enum Scope {
    span @0;
    file @1;
    repo @2;
    workspace @3;
    node @4;
    chain @5;
    global @6;
}

# ============================================================================
# Common Types
# ============================================================================

struct Timestamp {
    seconds @0 :Int64;
    nanos @1 :UInt32;
}

struct Label {
    key @0 :Text;
    value @1 :Text;
}

struct Progress {
    done @0 :UInt64;
    total @1 :UInt64;
    message @2 :Text;
}

struct CallContext {
    traceId @0 :Text;
    spanId @1 :Text;
    timeout @2 :UInt64;
    organizationId @3 :Text;
    authToken @4 :Text;
}

# ============================================================================
# Streaming Primitives
# ============================================================================

interface EventStream {
    next @0 () -> (event :Event, done :Bool);
    cancel @1 () -> ();
}

struct Event {
    type @0 :Text;
    data @1 :Data;
    timestamp @2 :UInt64;
}

interface Task {
    status @0 () -> (status :TaskStatus);
    result @1 () -> (data :Data);
    cancel @2 () -> ();
    output @3 () -> (stream :EventStream);
}

enum TaskState {
    pending @0;
    running @1;
    completed @2;
    failed @3;
    cancelled @4;
}

struct TaskStatus {
    state @0 :TaskState;
    progress @1 :Progress;
    startedAt @2 :UInt64;
    updatedAt @3 :UInt64;
    error @4 :Text;
}

# ============================================================================
# Bootstrap Types
# ============================================================================

struct Implementation {
    name @0 :Text;
    version @1 :Text;
}

struct ClientCaps {
    roots @0 :Bool;
    sampling @1 :Bool;
    elicitation @2 :Bool;
}

struct EndpointCaps {
    cloud @0 :Bool;
    scaling @1 :Bool;
    pool @2 :Bool;
    infra @3 :Bool;
    deploy @4 :Bool;
    consensus @5 :Bool;
}

struct Hello {
    protocolVersion @0 :Text;
    clientInfo @1 :Implementation;
    capabilities @2 :ClientCaps;
    organizationId @3 :Text;
}

struct Welcome {
    protocolVersion @0 :Text;
    endpointInfo @1 :Implementation;
    capabilities @2 :EndpointCaps;
    instructions @3 :Text;
}

# ============================================================================
# CLOUD PROVIDER MANAGEMENT
# ============================================================================

enum ProviderType {
    digitalocean @0;
    aws @1;
    gcp @2;
    azure @3;
    hetzner @4;
    vultr @5;
    linode @6;
}

enum ProviderStatus {
    active @0;
    inactive @1;
    error @2;
    validating @3;
}

struct CloudProvider {
    providerId @0 :Text;
    name @1 :Text;
    slug @2 :Text;
    type @3 :ProviderType;
    status @4 :ProviderStatus;
    defaultRegion @5 :Text;
    defaultSize @6 :Text;
    defaultImage @7 :Text;
    organizationId @8 :Text;
    createdAt @9 :UInt64;
    lastValidated @10 :UInt64;
}

struct ConfigureProviderRequest {
    name @0 :Text;
    slug @1 :Text;
    apiToken @2 :Text;
    type @3 :ProviderType;
    defaultRegion @4 :Text;
    defaultSize @5 :Text;
    defaultImage @6 :Text;
}

struct UpdateProviderRequest {
    providerId @0 :Text;
    name @1 :Text;
    apiToken @2 :Text;
    defaultRegion @3 :Text;
    defaultSize @4 :Text;
    defaultImage @5 :Text;
    isActive @6 :Bool;
}

struct Region {
    slug @0 :Text;
    name @1 :Text;
    available @2 :Bool;
    sizes @3 :List(Text);
}

struct Size {
    slug @0 :Text;
    vcpus @1 :UInt32;
    memory @2 :UInt64;  # MB
    disk @3 :UInt64;    # GB
    priceMonthly @4 :Float64;
    priceHourly @5 :Float64;
    available @6 :Bool;
    regions @7 :List(Text);
}

# ============================================================================
# SCALING OPERATIONS
# ============================================================================

enum NodeType {
    worker @0;
    manager @1;
}

enum ScaleStrategy {
    oldest @0;
    newest @1;
    leastUtilized @2;
    mostUtilized @3;
    specific @4;
    random @5;
}

struct ScaleUpRequest {
    poolId @0 :Text;
    providerId @1 :Text;
    count @2 :UInt32;
    size @3 :Text;
    region @4 :Text;
    nodeType @5 :NodeType;
    labels @6 :List(Label);
    userData @7 :Text;
    sshKeyIds @8 :List(Text);
    enableMonitoring @9 :Bool;
    enableBackups @10 :Bool;
}

struct ScaleDownRequest {
    poolId @0 :Text;
    count @1 :UInt32;
    strategy @2 :ScaleStrategy;
    nodeIds @3 :List(Text);
    force @4 :Bool;
    drainTimeout @5 :UInt64;
}

enum ScalingJobType {
    scaleUp @0;
    scaleDown @1;
    resize @2;
    migrate @3;
}

enum JobStatus {
    pending @0;
    inProgress @1;
    completed @2;
    failed @3;
    cancelled @4;
    partiallyCompleted @5;
}

struct ScalingJob {
    jobId @0 :Text;
    poolId @1 :Text;
    type @2 :ScalingJobType;
    status @3 :JobStatus;
    targetCount @4 :UInt32;
    completedCount @5 :UInt32;
    failedCount @6 :UInt32;
    createdAt @7 :UInt64;
    updatedAt @8 :UInt64;
    completedAt @9 :UInt64;
    error @10 :Text;
    nodeIds @11 :List(Text);
}

struct ResizeDropletRequest {
    dropletId @0 :Text;
    newSize @1 :Text;
    resizeDisk @2 :Bool;
}

struct DrainNodeRequest {
    nodeId @0 :Text;
    force @1 :Bool;
    timeout @2 :UInt64;
    gracePeriod @3 :UInt64;
}

# ============================================================================
# NODE MANAGEMENT
# ============================================================================

enum NodeStatus {
    provisioning @0;
    bootstrapping @1;
    active @2;
    draining @3;
    cordoned @4;
    terminated @5;
    error @6;
    unknown @7;
}

struct Node {
    nodeId @0 :Text;
    poolId @1 :Text;
    dropletId @2 :Text;
    status @3 :NodeStatus;
    publicIp @4 :Text;
    privateIp @5 :Text;
    hostname @6 :Text;
    size @7 :Text;
    region @8 :Text;
    cpuUtilization @9 :Float64;
    memoryUtilization @10 :Float64;
    diskUtilization @11 :Float64;
    networkIn @12 :UInt64;
    networkOut @13 :UInt64;
    labels @14 :List(Label);
    createdAt @15 :UInt64;
    lastHeartbeat @16 :UInt64;
}

struct NodeStatusUpdate {
    poolId @0 :Text;
    nodes @1 :List(Node);
    timestamp @2 :UInt64;
}

# ============================================================================
# COMPUTE POOL MANAGEMENT
# ============================================================================

enum PoolStatus {
    creating @0;
    active @1;
    scaling @2;
    updating @3;
    deleting @4;
    error @5;
}

struct AutoScalingConfig {
    enabled @0 :Bool;
    minNodes @1 :UInt32;
    maxNodes @2 :UInt32;
    targetCpuUtilization @3 :Float64;
    targetMemoryUtilization @4 :Float64;
    scaleUpCooldownSeconds @5 :UInt32;
    scaleDownCooldownSeconds @6 :UInt32;
    scaleUpThreshold @7 :Float64;
    scaleDownThreshold @8 :Float64;
}

struct ComputePool {
    poolId @0 :Text;
    name @1 :Text;
    organizationId @2 :Text;
    providerId @3 :Text;
    status @4 :PoolStatus;
    minNodes @5 :UInt32;
    maxNodes @6 :UInt32;
    currentNodes @7 :UInt32;
    targetNodes @8 :UInt32;
    autoScaling @9 :AutoScalingConfig;
    defaultSize @10 :Text;
    defaultRegion @11 :Text;
    labels @12 :List(Label);
    createdAt @13 :UInt64;
    updatedAt @14 :UInt64;
}

struct CreatePoolRequest {
    name @0 :Text;
    providerId @1 :Text;
    minNodes @2 :UInt32;
    maxNodes @3 :UInt32;
    defaultSize @4 :Text;
    defaultRegion @5 :Text;
    autoScaling @6 :AutoScalingConfig;
    labels @7 :List(Label);
}

# ============================================================================
# INFRASTRUCTURE MANAGEMENT
# ============================================================================

struct FirewallRule {
    protocol @0 :Text;
    ports @1 :Text;
    sources @2 :List(Text);
    destinations @3 :List(Text);
}

struct CreateFirewallRequest {
    providerId @0 :Text;
    poolId @1 :Text;
    name @2 :Text;
    inboundRules @3 :List(FirewallRule);
    outboundRules @4 :List(FirewallRule);
    dropletIds @5 :List(Text);
    tags @6 :List(Text);
}

struct Firewall {
    firewallId @0 :Text;
    name @1 :Text;
    status @2 :Text;
    inboundRules @3 :List(FirewallRule);
    outboundRules @4 :List(FirewallRule);
    dropletIds @5 :List(Text);
    tags @6 :List(Text);
    createdAt @7 :UInt64;
}

struct HealthCheck {
    protocol @0 :Text;
    port @1 :UInt16;
    path @2 :Text;
    checkIntervalSeconds @3 :UInt32;
    responseTimeoutSeconds @4 :UInt32;
    unhealthyThreshold @5 :UInt32;
    healthyThreshold @6 :UInt32;
}

struct ForwardingRule {
    entryProtocol @0 :Text;
    entryPort @1 :UInt16;
    targetProtocol @2 :Text;
    targetPort @3 :UInt16;
    certificateId @4 :Text;
    tlsPassthrough @5 :Bool;
}

enum LBAlgorithm {
    roundRobin @0;
    leastConnections @1;
}

struct CreateLoadBalancerRequest {
    providerId @0 :Text;
    poolId @1 :Text;
    name @2 :Text;
    region @3 :Text;
    algorithm @4 :LBAlgorithm;
    healthCheck @5 :HealthCheck;
    forwardingRules @6 :List(ForwardingRule);
    dropletIds @7 :List(Text);
    tag @8 :Text;
    redirectHttpToHttps @9 :Bool;
    enableProxyProtocol @10 :Bool;
    enableBackendKeepalive @11 :Bool;
}

struct LoadBalancer {
    loadBalancerId @0 :Text;
    name @1 :Text;
    ip @2 :Text;
    status @3 :Text;
    algorithm @4 :LBAlgorithm;
    region @5 :Text;
    healthCheck @6 :HealthCheck;
    forwardingRules @7 :List(ForwardingRule);
    dropletIds @8 :List(Text);
    createdAt @9 :UInt64;
}

# ============================================================================
# APPLICATION DEPLOYMENT
# ============================================================================

enum ApplicationStatus {
    idle @0;
    running @1;
    deploying @2;
    error @3;
    stopped @4;
    restarting @5;
}

enum BuildType {
    dockerfile @0;
    nixpacks @1;
    buildpacks @2;
    heroku @3;
    docker @4;
    railpack @5;
}

enum SourceType {
    github @0;
    gitlab @1;
    bitbucket @2;
    gitea @3;
    git @4;
    dockerImage @5;
}

struct Application {
    applicationId @0 :Text;
    name @1 :Text;
    appName @2 :Text;
    description @3 :Text;
    projectId @4 :Text;
    serverId @5 :Text;
    status @6 :ApplicationStatus;
    buildType @7 :BuildType;
    sourceType @8 :SourceType;
    dockerImage @9 :Text;
    repository @10 :Text;
    branch @11 :Text;
    env @12 :Text;
    replicas @13 :UInt32;
    cpuLimit @14 :Text;
    memoryLimit @15 :Text;
    memoryReservation @16 :Text;
    createdAt @17 :UInt64;
    updatedAt @18 :UInt64;
}

struct DeployRequest {
    applicationId @0 :Text;
    force @1 :Bool;
    clearCache @2 :Bool;
}

struct DeployResult {
    deploymentId @0 :Text;
    status @1 :ApplicationStatus;
    logs @2 :Text;
    startedAt @3 :UInt64;
    task @4 :Task;
}

struct Project {
    projectId @0 :Text;
    name @1 :Text;
    description @2 :Text;
    organizationId @3 :Text;
    env @4 :Text;
    createdAt @5 :UInt64;
}

# ============================================================================
# TOOL CATALOG
# ============================================================================

enum Stability {
    experimental @0;
    beta @1;
    stable @2;
    deprecated @3;
}

struct ToolId {
    namespace @0 :Text;
    name @1 :Text;
    version @2 :Text;
}

struct ToolInfo {
    id @0 :ToolId;
    description @1 :Text;
    effect @2 :Effect;
    idempotent @3 :Bool;
    inputSchema @4 :Data;
    outputSchema @5 :Data;
    stability @6 :Stability;
}

# ============================================================================
# INTERFACES
# ============================================================================

interface Cloud {
    configureProvider @0 (req :ConfigureProviderRequest, ctx :CallContext) -> (provider :CloudProvider)
        $methodEffect(nondeterministic);

    updateProvider @1 (req :UpdateProviderRequest, ctx :CallContext) -> (provider :CloudProvider)
        $methodEffect(nondeterministic);

    listProviders @2 (ctx :CallContext) -> (providers :List(CloudProvider))
        $methodEffect(deterministic)
        $idempotent(true);

    getProvider @3 (providerId :Text, ctx :CallContext) -> (provider :CloudProvider)
        $methodEffect(deterministic)
        $idempotent(true);

    deleteProvider @4 (providerId :Text, ctx :CallContext) -> (success :Bool)
        $methodEffect(nondeterministic);

    listRegions @5 (providerId :Text, ctx :CallContext) -> (regions :List(Region))
        $methodEffect(deterministic)
        $idempotent(true);

    listSizes @6 (providerId :Text, region :Text, ctx :CallContext) -> (sizes :List(Size))
        $methodEffect(deterministic)
        $idempotent(true);
}

interface Scaling {
    scaleUp @0 (req :ScaleUpRequest, ctx :CallContext) -> (job :ScalingJob)
        $methodEffect(nondeterministic)
        $methodScope(node);

    scaleDown @1 (req :ScaleDownRequest, ctx :CallContext) -> (job :ScalingJob)
        $methodEffect(nondeterministic)
        $methodScope(node);

    resizeDroplet @2 (req :ResizeDropletRequest, ctx :CallContext) -> (task :Task)
        $methodEffect(nondeterministic);

    drainNode @3 (req :DrainNodeRequest, ctx :CallContext) -> (task :Task)
        $methodEffect(nondeterministic);

    getScalingJob @4 (jobId :Text, ctx :CallContext) -> (job :ScalingJob)
        $methodEffect(deterministic)
        $idempotent(true);

    listScalingJobs @5 (poolId :Text, limit :UInt32, ctx :CallContext) -> (jobs :List(ScalingJob))
        $methodEffect(deterministic)
        $idempotent(true);

    cancelScalingJob @6 (jobId :Text, ctx :CallContext) -> (success :Bool)
        $methodEffect(nondeterministic);
}

interface Pool {
    createPool @0 (req :CreatePoolRequest, ctx :CallContext) -> (pool :ComputePool)
        $methodEffect(nondeterministic);

    getPool @1 (poolId :Text, ctx :CallContext) -> (pool :ComputePool)
        $methodEffect(deterministic)
        $idempotent(true);

    listPools @2 (ctx :CallContext) -> (pools :List(ComputePool))
        $methodEffect(deterministic)
        $idempotent(true);

    updatePool @3 (poolId :Text, name :Text, autoScaling :AutoScalingConfig, ctx :CallContext) -> (pool :ComputePool)
        $methodEffect(nondeterministic);

    deletePool @4 (poolId :Text, force :Bool, ctx :CallContext) -> (task :Task)
        $methodEffect(nondeterministic);

    listNodes @5 (poolId :Text, ctx :CallContext) -> (nodes :List(Node))
        $methodEffect(deterministic)
        $idempotent(true);

    getNode @6 (nodeId :Text, ctx :CallContext) -> (node :Node)
        $methodEffect(deterministic)
        $idempotent(true);

    setAutoScaling @7 (poolId :Text, config :AutoScalingConfig, ctx :CallContext) -> (pool :ComputePool)
        $methodEffect(nondeterministic);

    subscribeNodeStatus @8 (poolId :Text) -> (stream :EventStream)
        $methodEffect(nondeterministic);
}

interface Infra {
    createFirewall @0 (req :CreateFirewallRequest, ctx :CallContext) -> (firewall :Firewall)
        $methodEffect(nondeterministic);

    getFirewall @1 (firewallId :Text, ctx :CallContext) -> (firewall :Firewall)
        $methodEffect(deterministic)
        $idempotent(true);

    updateFirewall @2 (firewallId :Text, inboundRules :List(FirewallRule), outboundRules :List(FirewallRule), ctx :CallContext) -> (firewall :Firewall)
        $methodEffect(nondeterministic);

    deleteFirewall @3 (firewallId :Text, ctx :CallContext) -> (success :Bool)
        $methodEffect(nondeterministic);

    createLoadBalancer @4 (req :CreateLoadBalancerRequest, ctx :CallContext) -> (lb :LoadBalancer)
        $methodEffect(nondeterministic);

    getLoadBalancer @5 (loadBalancerId :Text, ctx :CallContext) -> (lb :LoadBalancer)
        $methodEffect(deterministic)
        $idempotent(true);

    updateLoadBalancer @6 (loadBalancerId :Text, healthCheck :HealthCheck, forwardingRules :List(ForwardingRule), ctx :CallContext) -> (lb :LoadBalancer)
        $methodEffect(nondeterministic);

    deleteLoadBalancer @7 (loadBalancerId :Text, ctx :CallContext) -> (success :Bool)
        $methodEffect(nondeterministic);
}

interface Deploy {
    deploy @0 (req :DeployRequest, ctx :CallContext) -> (result :DeployResult)
        $methodEffect(nondeterministic)
        $methodScope(node);

    redeploy @1 (applicationId :Text, ctx :CallContext) -> (result :DeployResult)
        $methodEffect(nondeterministic);

    start @2 (applicationId :Text, ctx :CallContext) -> (success :Bool)
        $methodEffect(nondeterministic);

    stop @3 (applicationId :Text, ctx :CallContext) -> (success :Bool)
        $methodEffect(nondeterministic);

    restart @4 (applicationId :Text, ctx :CallContext) -> (success :Bool)
        $methodEffect(nondeterministic);

    getApplication @5 (applicationId :Text, ctx :CallContext) -> (app :Application)
        $methodEffect(deterministic)
        $idempotent(true);

    listApplications @6 (projectId :Text, ctx :CallContext) -> (apps :List(Application))
        $methodEffect(deterministic)
        $idempotent(true);

    listProjects @7 (ctx :CallContext) -> (projects :List(Project))
        $methodEffect(deterministic)
        $idempotent(true);

    getLogs @8 (applicationId :Text, tail :UInt32, since :UInt64, ctx :CallContext) -> (logs :Text)
        $methodEffect(deterministic);

    streamLogs @9 (applicationId :Text) -> (stream :EventStream)
        $methodEffect(nondeterministic);
}

# ============================================================================
# TOP-LEVEL PLATFORM INTERFACE
# ============================================================================

interface Platform {
    # Bootstrap
    initialize @0 (hello :Hello) -> (welcome :Welcome)
        $methodEffect(pure)
        $idempotent(true);

    # Platform capabilities
    cloud @1 () -> (cloud :Cloud)
        $methodEffect(pure);

    scaling @2 () -> (scaling :Scaling)
        $methodEffect(pure);

    pool @3 () -> (pool :Pool)
        $methodEffect(pure);

    infra @4 () -> (infra :Infra)
        $methodEffect(pure);

    deploy @5 () -> (deploy :Deploy)
        $methodEffect(pure);

    # Health
    ping @6 () -> (latencyNs :UInt64, serverTime :UInt64)
        $methodEffect(pure)
        $idempotent(true);

    # Catalog
    getCatalog @7 () -> (tools :List(ToolInfo))
        $methodEffect(deterministic)
        $idempotent(true);
}
