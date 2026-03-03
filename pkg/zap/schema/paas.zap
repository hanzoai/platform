# ============================================================================
# Hanzo PaaS ZAP Schema
# ============================================================================
#
# ZAP schema for the Hanzo PaaS platform.
# Extends platform.capnp with Dokploy-derived interfaces for managed
# databases, compose stacks, certificates, domains, backups,
# notifications, monitoring, servers, swarm, and billing.
#
# Version: 2.0.0
# Profile: zap-capnp-1
#
# ============================================================================

# ============================================================================
# Common Types (ported from platform.capnp)
# ============================================================================

struct Timestamp
  seconds Int64
  nanos   UInt32

struct Label
  key   Text
  value Text

struct Progress
  done    UInt64
  total   UInt64
  message Text

struct CallContext
  traceId        Text
  spanId         Text
  timeout        UInt64
  organizationId Text
  authToken      Text

# ============================================================================
# Streaming Primitives
# ============================================================================

struct Event
  type      Text
  data      Data
  timestamp UInt64

interface EventStream
  next   () -> (event Event, done Bool)
  cancel () -> ()

interface Task
  status () -> (status TaskStatus)
  result () -> (data Data)
  cancel () -> ()
  output () -> (stream EventStream)

enum TaskState
  pending
  running
  completed
  failed
  cancelled

struct TaskStatus
  state     TaskState
  progress  Progress
  startedAt UInt64
  updatedAt UInt64
  error     Text

# ============================================================================
# Bootstrap Types
# ============================================================================

struct Implementation
  name    Text
  version Text

struct ClientCaps
  roots       Bool
  sampling    Bool
  elicitation Bool

struct EndpointCaps
  cloud       Bool
  scaling     Bool
  pool        Bool
  infra       Bool
  deploy      Bool
  consensus   Bool
  database    Bool
  compose     Bool
  certificate Bool
  domain      Bool
  backup      Bool
  notification Bool
  monitoring  Bool
  server      Bool
  swarm       Bool
  billing     Bool

struct Hello
  protocolVersion Text
  clientInfo      Implementation
  capabilities    ClientCaps
  organizationId  Text

struct Welcome
  protocolVersion Text
  endpointInfo    Implementation
  capabilities    EndpointCaps
  instructions    Text

# ============================================================================
# CLOUD PROVIDER MANAGEMENT
# ============================================================================

enum ProviderType
  digitalocean
  aws
  gcp
  azure
  hetzner
  vultr
  linode

enum ProviderStatus
  active
  inactive
  error
  validating

struct CloudProvider
  providerId    Text
  name          Text
  slug          Text
  type          ProviderType
  status        ProviderStatus
  defaultRegion Text
  defaultSize   Text
  defaultImage  Text
  organizationId Text
  createdAt     UInt64
  lastValidated UInt64

struct ConfigureProviderRequest
  name          Text
  slug          Text
  apiToken      Text
  type          ProviderType
  defaultRegion Text
  defaultSize   Text
  defaultImage  Text

struct UpdateProviderRequest
  providerId    Text
  name          Text
  apiToken      Text
  defaultRegion Text
  defaultSize   Text
  defaultImage  Text
  isActive      Bool

struct Region
  slug      Text
  name      Text
  available Bool
  sizes     List(Text)

struct Size
  slug         Text
  vcpus        UInt32
  memory       UInt64
  disk         UInt64
  priceMonthly Float64
  priceHourly  Float64
  available    Bool
  regions      List(Text)

# ============================================================================
# SCALING OPERATIONS
# ============================================================================

enum NodeType
  worker
  manager

enum ScaleStrategy
  oldest
  newest
  leastUtilized
  mostUtilized
  specific
  random

struct ScaleUpRequest
  poolId           Text
  providerId       Text
  count            UInt32
  size             Text
  region           Text
  nodeType         NodeType
  labels           List(Label)
  userData         Text
  sshKeyIds        List(Text)
  enableMonitoring Bool
  enableBackups    Bool

struct ScaleDownRequest
  poolId       Text
  count        UInt32
  strategy     ScaleStrategy
  nodeIds      List(Text)
  force        Bool
  drainTimeout UInt64

enum ScalingJobType
  scaleUp
  scaleDown
  resize
  migrate

enum JobStatus
  pending
  inProgress
  completed
  failed
  cancelled
  partiallyCompleted

struct ScalingJob
  jobId          Text
  poolId         Text
  type           ScalingJobType
  status         JobStatus
  targetCount    UInt32
  completedCount UInt32
  failedCount    UInt32
  createdAt      UInt64
  updatedAt      UInt64
  completedAt    UInt64
  error          Text
  nodeIds        List(Text)

struct ResizeDropletRequest
  dropletId  Text
  newSize    Text
  resizeDisk Bool

struct DrainNodeRequest
  nodeId      Text
  force       Bool
  timeout     UInt64
  gracePeriod UInt64

# ============================================================================
# NODE MANAGEMENT
# ============================================================================

enum NodeStatus
  provisioning
  bootstrapping
  active
  draining
  cordoned
  terminated
  error
  unknown

struct Node
  nodeId             Text
  poolId             Text
  dropletId          Text
  status             NodeStatus
  publicIp           Text
  privateIp          Text
  hostname           Text
  size               Text
  region             Text
  cpuUtilization     Float64
  memoryUtilization  Float64
  diskUtilization    Float64
  networkIn          UInt64
  networkOut         UInt64
  labels             List(Label)
  createdAt          UInt64
  lastHeartbeat      UInt64

struct NodeStatusUpdate
  poolId    Text
  nodes     List(Node)
  timestamp UInt64

# ============================================================================
# COMPUTE POOL MANAGEMENT
# ============================================================================

enum PoolStatus
  creating
  active
  scaling
  updating
  deleting
  error

struct AutoScalingConfig
  enabled                    Bool
  minNodes                   UInt32
  maxNodes                   UInt32
  targetCpuUtilization       Float64
  targetMemoryUtilization    Float64
  scaleUpCooldownSeconds     UInt32
  scaleDownCooldownSeconds   UInt32
  scaleUpThreshold           Float64
  scaleDownThreshold         Float64

struct ComputePool
  poolId         Text
  name           Text
  organizationId Text
  providerId     Text
  status         PoolStatus
  minNodes       UInt32
  maxNodes       UInt32
  currentNodes   UInt32
  targetNodes    UInt32
  autoScaling    AutoScalingConfig
  defaultSize    Text
  defaultRegion  Text
  labels         List(Label)
  createdAt      UInt64
  updatedAt      UInt64

struct CreatePoolRequest
  name          Text
  providerId    Text
  minNodes      UInt32
  maxNodes      UInt32
  defaultSize   Text
  defaultRegion Text
  autoScaling   AutoScalingConfig
  labels        List(Label)

# ============================================================================
# INFRASTRUCTURE MANAGEMENT
# ============================================================================

struct FirewallRule
  protocol     Text
  ports        Text
  sources      List(Text)
  destinations List(Text)

struct CreateFirewallRequest
  providerId    Text
  poolId        Text
  name          Text
  inboundRules  List(FirewallRule)
  outboundRules List(FirewallRule)
  dropletIds    List(Text)
  tags          List(Text)

struct Firewall
  firewallId    Text
  name          Text
  status        Text
  inboundRules  List(FirewallRule)
  outboundRules List(FirewallRule)
  dropletIds    List(Text)
  tags          List(Text)
  createdAt     UInt64

struct HealthCheck
  protocol               Text
  port                   UInt16
  path                   Text
  checkIntervalSeconds   UInt32
  responseTimeoutSeconds UInt32
  unhealthyThreshold     UInt32
  healthyThreshold       UInt32

struct ForwardingRule
  entryProtocol  Text
  entryPort      UInt16
  targetProtocol Text
  targetPort     UInt16
  certificateId  Text
  tlsPassthrough Bool

enum LBAlgorithm
  roundRobin
  leastConnections

struct CreateLoadBalancerRequest
  providerId             Text
  poolId                 Text
  name                   Text
  region                 Text
  algorithm              LBAlgorithm
  healthCheck            HealthCheck
  forwardingRules        List(ForwardingRule)
  dropletIds             List(Text)
  tag                    Text
  redirectHttpToHttps    Bool
  enableProxyProtocol    Bool
  enableBackendKeepalive Bool

struct LoadBalancer
  loadBalancerId Text
  name           Text
  ip             Text
  status         Text
  algorithm      LBAlgorithm
  region         Text
  healthCheck    HealthCheck
  forwardingRules List(ForwardingRule)
  dropletIds     List(Text)
  createdAt      UInt64

# ============================================================================
# APPLICATION DEPLOYMENT
# ============================================================================

enum ApplicationStatus
  idle
  running
  deploying
  error
  stopped
  restarting

enum BuildType
  dockerfile
  nixpacks
  buildpacks
  heroku
  docker
  railpack

enum SourceType
  github
  gitlab
  bitbucket
  gitea
  git
  dockerImage

struct Application
  applicationId     Text
  name              Text
  appName           Text
  description       Text
  projectId         Text
  serverId          Text
  status            ApplicationStatus
  buildType         BuildType
  sourceType        SourceType
  dockerImage       Text
  repository        Text
  branch            Text
  env               Text
  replicas          UInt32
  cpuLimit          Text
  memoryLimit       Text
  memoryReservation Text
  createdAt         UInt64
  updatedAt         UInt64

struct DeployRequest
  applicationId Text
  force         Bool
  clearCache    Bool

struct DeployResult
  deploymentId Text
  status       ApplicationStatus
  logs         Text
  startedAt    UInt64
  task         Task

struct Project
  projectId      Text
  name           Text
  description    Text
  organizationId Text
  env            Text
  createdAt      UInt64

# ============================================================================
# TOOL CATALOG
# ============================================================================

enum Stability
  experimental
  beta
  stable
  deprecated

struct ToolId
  namespace Text
  name      Text
  version   Text

struct ToolInfo
  id           ToolId
  description  Text
  effect       Effect
  idempotent   Bool
  inputSchema  Data
  outputSchema Data
  stability    Stability

enum Effect
  pure
  deterministic
  nondeterministic

enum Scope
  span
  file
  repo
  workspace
  node
  chain
  global

# ============================================================================
# DATABASE MANAGEMENT (new)
# ============================================================================

enum DatabaseType
  postgres
  mysql
  mariadb
  mongo
  redis

enum DatabaseStatus
  idle
  running
  deploying
  error
  stopped

struct DatabaseInstance
  id                Text
  name              Text
  appName           Text
  databaseType      DatabaseType
  databaseName      Text
  databaseUser      Text
  databasePassword  Text
  dockerImage       Text
  command           Text
  env               Text
  memoryReservation Text
  memoryLimit       Text
  cpuReservation    Text
  cpuLimit          Text
  externalPort      UInt32
  status            DatabaseStatus
  replicas          UInt32
  serverId          Text
  environmentId     Text
  createdAt         UInt64

struct CreateDatabaseRequest
  name             Text
  appName          Text
  databaseType     DatabaseType
  databaseName     Text
  databaseUser     Text
  databasePassword Text
  dockerImage      Text
  serverId         Text
  environmentId    Text

struct SaveDatabaseEnvRequest
  databaseId Text
  env        Text

struct SaveDatabasePortRequest
  databaseId   Text
  externalPort UInt32

interface Database
  create           (req CreateDatabaseRequest, ctx CallContext) -> (db DatabaseInstance)
  get              (databaseId Text, ctx CallContext) -> (db DatabaseInstance)
  list             (environmentId Text, ctx CallContext) -> (databases List(DatabaseInstance))
  delete           (databaseId Text, ctx CallContext) -> (success Bool)
  deploy           (databaseId Text, ctx CallContext) -> (task Task)
  start            (databaseId Text, ctx CallContext) -> (success Bool)
  stop             (databaseId Text, ctx CallContext) -> (success Bool)
  rebuild          (databaseId Text, ctx CallContext) -> (task Task)
  saveEnvironment  (req SaveDatabaseEnvRequest, ctx CallContext) -> (success Bool)
  saveExternalPort (req SaveDatabasePortRequest, ctx CallContext) -> (success Bool)

# ============================================================================
# COMPOSE STACK MANAGEMENT (new)
# ============================================================================

enum ComposeType
  dockerCompose
  stack

enum ComposeStatus
  idle
  running
  deploying
  error
  stopped

struct ComposeInstance
  id            Text
  name          Text
  appName       Text
  description   Text
  composeFile   Text
  sourceType    SourceType
  composeType   ComposeType
  repository    Text
  owner         Text
  branch        Text
  autoDeploy    Bool
  status        ComposeStatus
  environmentId Text
  serverId      Text
  createdAt     UInt64

struct CreateComposeRequest
  name          Text
  appName       Text
  description   Text
  composeFile   Text
  sourceType    SourceType
  composeType   ComposeType
  repository    Text
  owner         Text
  branch        Text
  autoDeploy    Bool
  serverId      Text
  environmentId Text

struct UpdateComposeRequest
  composeId   Text
  name        Text
  description Text
  composeFile Text
  autoDeploy  Bool

struct SaveComposeEnvRequest
  composeId Text
  env       Text

interface Compose
  create          (req CreateComposeRequest, ctx CallContext) -> (compose ComposeInstance)
  get             (composeId Text, ctx CallContext) -> (compose ComposeInstance)
  list            (environmentId Text, ctx CallContext) -> (composes List(ComposeInstance))
  delete          (composeId Text, ctx CallContext) -> (success Bool)
  deploy          (composeId Text, ctx CallContext) -> (task Task)
  start           (composeId Text, ctx CallContext) -> (success Bool)
  stop            (composeId Text, ctx CallContext) -> (success Bool)
  reload          (composeId Text, ctx CallContext) -> (task Task)
  saveEnvironment (req SaveComposeEnvRequest, ctx CallContext) -> (success Bool)
  update          (req UpdateComposeRequest, ctx CallContext) -> (compose ComposeInstance)

# ============================================================================
# CERTIFICATE MANAGEMENT (new)
# ============================================================================

enum CertificateStatus
  pending
  active
  expired
  error

struct CertificateInfo
  id              Text
  name            Text
  certificateData Text
  privateKey      Text
  autoRenew       Bool
  domains         List(Text)
  status          CertificateStatus
  organizationId  Text
  serverId        Text
  createdAt       UInt64

struct CreateCertificateRequest
  name            Text
  certificateData Text
  privateKey      Text
  autoRenew       Bool
  domains         List(Text)
  serverId        Text

interface Certificate
  create (req CreateCertificateRequest, ctx CallContext) -> (cert CertificateInfo)
  get    (certificateId Text, ctx CallContext) -> (cert CertificateInfo)
  list   (organizationId Text, ctx CallContext) -> (certs List(CertificateInfo))
  delete (certificateId Text, ctx CallContext) -> (success Bool)

# ============================================================================
# DOMAIN MANAGEMENT (new)
# ============================================================================

enum DomainType
  application
  compose
  database

enum CertificateType
  letsencrypt
  custom
  none

struct DomainInfo
  id              Text
  host            Text
  https           Bool
  port            UInt32
  path            Text
  serviceName     Text
  domainType      DomainType
  certificateType CertificateType
  applicationId   Text
  composeId       Text
  createdAt       UInt64

struct CreateDomainRequest
  host            Text
  https           Bool
  port            UInt32
  path            Text
  serviceName     Text
  domainType      DomainType
  certificateType CertificateType
  applicationId   Text
  composeId       Text

struct UpdateDomainRequest
  domainId        Text
  host            Text
  https           Bool
  port            UInt32
  path            Text
  certificateType CertificateType

interface Domain
  create   (req CreateDomainRequest, ctx CallContext) -> (domain DomainInfo)
  get      (domainId Text, ctx CallContext) -> (domain DomainInfo)
  list     (applicationId Text, ctx CallContext) -> (domains List(DomainInfo))
  update   (req UpdateDomainRequest, ctx CallContext) -> (domain DomainInfo)
  delete   (domainId Text, ctx CallContext) -> (success Bool)
  validate (domainId Text, ctx CallContext) -> (valid Bool, error Text)

# ============================================================================
# BACKUP AND RESTORE (new)
# ============================================================================

enum BackupType
  database
  compose
  application

enum BackupStatus
  pending
  running
  completed
  failed

struct BackupInfo
  id              Text
  appName         Text
  schedule        Text
  enabled         Bool
  database        Text
  prefix          Text
  serviceName     Text
  destinationId   Text
  keepLatestCount UInt32
  backupType      BackupType
  databaseType    DatabaseType
  status          BackupStatus
  metadata        Text
  createdAt       UInt64

struct CreateBackupRequest
  appName         Text
  schedule        Text
  enabled         Bool
  database        Text
  prefix          Text
  serviceName     Text
  destinationId   Text
  keepLatestCount UInt32
  backupType      BackupType
  databaseType    DatabaseType

struct ScheduleBackupRequest
  backupId Text
  schedule Text
  enabled  Bool

interface Backup
  create   (req CreateBackupRequest, ctx CallContext) -> (backup BackupInfo)
  list     (appName Text, ctx CallContext) -> (backups List(BackupInfo))
  delete   (backupId Text, ctx CallContext) -> (success Bool)
  restore  (backupId Text, ctx CallContext) -> (task Task)
  schedule (req ScheduleBackupRequest, ctx CallContext) -> (backup BackupInfo)

# ============================================================================
# NOTIFICATION MANAGEMENT (new)
# ============================================================================

enum NotificationType
  slack
  discord
  telegram
  email
  webhook
  gotify

struct NotificationInfo
  id               Text
  name             Text
  notificationType NotificationType
  appDeploy        Bool
  appBuildError    Bool
  databaseBackup   Bool
  platformRestart  Bool
  dockerCleanup    Bool
  serverThreshold  Bool
  webhookUrl       Text
  enabled          Bool
  organizationId   Text
  createdAt        UInt64

struct CreateNotificationRequest
  name             Text
  notificationType NotificationType
  appDeploy        Bool
  appBuildError    Bool
  databaseBackup   Bool
  platformRestart  Bool
  dockerCleanup    Bool
  serverThreshold  Bool
  webhookUrl       Text
  enabled          Bool

struct UpdateNotificationRequest
  notificationId  Text
  name            Text
  appDeploy       Bool
  appBuildError   Bool
  databaseBackup  Bool
  platformRestart Bool
  dockerCleanup   Bool
  serverThreshold Bool
  webhookUrl      Text
  enabled         Bool

interface Notification
  create (req CreateNotificationRequest, ctx CallContext) -> (notification NotificationInfo)
  list   (organizationId Text, ctx CallContext) -> (notifications List(NotificationInfo))
  update (req UpdateNotificationRequest, ctx CallContext) -> (notification NotificationInfo)
  delete (notificationId Text, ctx CallContext) -> (success Bool)
  test   (notificationId Text, ctx CallContext) -> (success Bool, error Text)

# ============================================================================
# MONITORING (new)
# ============================================================================

struct ContainerStats
  cpuUsage    Float64
  memoryUsage UInt64
  memoryLimit UInt64
  networkIn   UInt64
  networkOut  UInt64
  blockRead   UInt64
  blockWrite  UInt64

struct ServerStats
  cpuPercent    Float64
  memoryPercent Float64
  diskPercent   Float64
  networkIn     UInt64
  networkOut    UInt64
  uptime        UInt64

struct LogRequest
  containerId Text
  tail        UInt32
  since       UInt64
  timestamps  Bool

interface Monitoring
  containerStats (containerId Text, ctx CallContext) -> (stats ContainerStats)
  serverStats    (serverId Text, ctx CallContext) -> (stats ServerStats)
  getLogs        (req LogRequest, ctx CallContext) -> (logs Text)
  streamLogs     (containerId Text) -> (stream EventStream)

# ============================================================================
# SERVER MANAGEMENT (new)
# ============================================================================

enum ServerStatus
  provisioning
  active
  draining
  error
  disconnected

struct ServerInfo
  id             Text
  name           Text
  description    Text
  ipAddress      Text
  port           UInt32
  username       Text
  appName        Text
  status         ServerStatus
  command        Text
  sshKeyId       Text
  organizationId Text
  createdAt      UInt64

struct CreateServerRequest
  name        Text
  description Text
  ipAddress   Text
  port        UInt32
  username    Text
  sshKeyId    Text

struct UpdateServerRequest
  serverId    Text
  name        Text
  description Text
  ipAddress   Text
  port        UInt32
  username    Text

interface Server
  create   (req CreateServerRequest, ctx CallContext) -> (server ServerInfo)
  get      (serverId Text, ctx CallContext) -> (server ServerInfo)
  list     (organizationId Text, ctx CallContext) -> (servers List(ServerInfo))
  update   (req UpdateServerRequest, ctx CallContext) -> (server ServerInfo)
  delete   (serverId Text, ctx CallContext) -> (success Bool)
  setup    (serverId Text, ctx CallContext) -> (task Task)
  validate (serverId Text, ctx CallContext) -> (valid Bool, error Text)

# ============================================================================
# SWARM NODE MANAGEMENT (new)
# ============================================================================

struct SwarmNode
  id            Text
  hostname      Text
  status        Text
  role          Text
  availability  Text
  engineVersion Text
  addr          Text

struct SwarmApp
  id       Text
  name     Text
  image    Text
  replicas UInt32
  ports    List(Text)

interface Swarm
  getNodes    (ctx CallContext) -> (nodes List(SwarmNode))
  getNodeInfo (nodeId Text, ctx CallContext) -> (node SwarmNode)
  getNodeApps (nodeId Text, ctx CallContext) -> (apps List(SwarmApp))

# ============================================================================
# BILLING AND COST MANAGEMENT (new)
# ============================================================================

struct CostItem
  type         Text
  pool         Text
  size         Text
  count        UInt32
  unitPrice    Float64
  monthlyTotal Float64
  vcpus        UInt32
  memoryMb     UInt64
  diskGb       UInt64

struct CostBreakdown
  orgId        Text
  orgName      Text
  clusterId    Text
  clusterName  Text
  region       Text
  items        List(CostItem)
  subtotal     Float64
  markup       Float64
  monthlyTotal Float64
  currency     Text
  calculatedAt UInt64

struct FleetCostSummary
  organizations List(CostBreakdown)
  totalOrgs     UInt32
  totalMonthly  Float64
  totalNodes    UInt32
  totalVcpus    UInt32
  totalMemoryGb UInt32
  currency      Text
  calculatedAt  UInt64

struct UsageRecord
  orgId      Text
  resourceId Text
  type       Text
  amount     Float64
  unit       Text
  timestamp  UInt64

interface Billing
  getOrgCost   (orgId Text, ctx CallContext) -> (cost CostBreakdown)
  getFleetCost (ctx CallContext) -> (summary FleetCostSummary)
  recordUsage  (record UsageRecord, ctx CallContext) -> (success Bool)

# ============================================================================
# EXISTING INTERFACES (ported from platform.capnp)
# ============================================================================

interface Cloud
  configureProvider (req ConfigureProviderRequest, ctx CallContext) -> (provider CloudProvider)
  updateProvider    (req UpdateProviderRequest, ctx CallContext) -> (provider CloudProvider)
  listProviders     (ctx CallContext) -> (providers List(CloudProvider))
  getProvider       (providerId Text, ctx CallContext) -> (provider CloudProvider)
  deleteProvider    (providerId Text, ctx CallContext) -> (success Bool)
  listRegions       (providerId Text, ctx CallContext) -> (regions List(Region))
  listSizes         (providerId Text, region Text, ctx CallContext) -> (sizes List(Size))

interface Scaling
  scaleUp         (req ScaleUpRequest, ctx CallContext) -> (job ScalingJob)
  scaleDown       (req ScaleDownRequest, ctx CallContext) -> (job ScalingJob)
  resizeDroplet   (req ResizeDropletRequest, ctx CallContext) -> (task Task)
  drainNode       (req DrainNodeRequest, ctx CallContext) -> (task Task)
  getScalingJob   (jobId Text, ctx CallContext) -> (job ScalingJob)
  listScalingJobs (poolId Text, limit UInt32, ctx CallContext) -> (jobs List(ScalingJob))
  cancelScalingJob (jobId Text, ctx CallContext) -> (success Bool)

interface Pool
  createPool          (req CreatePoolRequest, ctx CallContext) -> (pool ComputePool)
  getPool             (poolId Text, ctx CallContext) -> (pool ComputePool)
  listPools           (ctx CallContext) -> (pools List(ComputePool))
  updatePool          (poolId Text, name Text, autoScaling AutoScalingConfig, ctx CallContext) -> (pool ComputePool)
  deletePool          (poolId Text, force Bool, ctx CallContext) -> (task Task)
  listNodes           (poolId Text, ctx CallContext) -> (nodes List(Node))
  getNode             (nodeId Text, ctx CallContext) -> (node Node)
  setAutoScaling      (poolId Text, config AutoScalingConfig, ctx CallContext) -> (pool ComputePool)
  subscribeNodeStatus (poolId Text) -> (stream EventStream)

interface Infra
  createFirewall       (req CreateFirewallRequest, ctx CallContext) -> (firewall Firewall)
  getFirewall          (firewallId Text, ctx CallContext) -> (firewall Firewall)
  updateFirewall       (firewallId Text, inboundRules List(FirewallRule), outboundRules List(FirewallRule), ctx CallContext) -> (firewall Firewall)
  deleteFirewall       (firewallId Text, ctx CallContext) -> (success Bool)
  createLoadBalancer   (req CreateLoadBalancerRequest, ctx CallContext) -> (lb LoadBalancer)
  getLoadBalancer      (loadBalancerId Text, ctx CallContext) -> (lb LoadBalancer)
  updateLoadBalancer   (loadBalancerId Text, healthCheck HealthCheck, forwardingRules List(ForwardingRule), ctx CallContext) -> (lb LoadBalancer)
  deleteLoadBalancer   (loadBalancerId Text, ctx CallContext) -> (success Bool)

interface Deploy
  deploy           (req DeployRequest, ctx CallContext) -> (result DeployResult)
  redeploy         (applicationId Text, ctx CallContext) -> (result DeployResult)
  start            (applicationId Text, ctx CallContext) -> (success Bool)
  stop             (applicationId Text, ctx CallContext) -> (success Bool)
  restart          (applicationId Text, ctx CallContext) -> (success Bool)
  getApplication   (applicationId Text, ctx CallContext) -> (app Application)
  listApplications (projectId Text, ctx CallContext) -> (apps List(Application))
  listProjects     (ctx CallContext) -> (projects List(Project))
  getLogs          (applicationId Text, tail UInt32, since UInt64, ctx CallContext) -> (logs Text)
  streamLogs       (applicationId Text) -> (stream EventStream)

# ============================================================================
# TOP-LEVEL PLATFORM INTERFACE (extended)
# ============================================================================

interface Platform
  # Bootstrap (@0)
  initialize   (hello Hello) -> (welcome Welcome)

  # Existing capabilities (@1-@5)
  cloud        () -> (cloud Cloud)
  scaling      () -> (scaling Scaling)
  pool         () -> (pool Pool)
  infra        () -> (infra Infra)
  deploy       () -> (deploy Deploy)

  # Health (@6)
  ping         () -> (latencyNs UInt64, serverTime UInt64)

  # Catalog (@7)
  getCatalog   () -> (tools List(ToolInfo))

  # New PaaS capabilities (@8-@17)
  database     () -> (database Database)
  compose      () -> (compose Compose)
  certificate  () -> (certificate Certificate)
  domain       () -> (domain Domain)
  backup       () -> (backup Backup)
  notification () -> (notification Notification)
  monitoring   () -> (monitoring Monitoring)
  server       () -> (server Server)
  swarm        () -> (swarm Swarm)
  billing      () -> (billing Billing)
