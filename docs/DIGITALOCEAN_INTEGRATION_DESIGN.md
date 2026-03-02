# DigitalOcean API Integration Design

## Overview

This document describes the architecture for integrating DigitalOcean as a managed cloud provider for the Hanzo Platform PaaS. The integration enables automatic provisioning, scaling, and management of compute nodes (Droplets) through the Platform admin interface.

## Architecture

```
+------------------+     +------------------+     +------------------+
|   Platform UI    |---->|   tRPC Router    |---->|   DO Service     |
|   (Admin Panel)  |     |   (digitalocean) |     |   (pkg/platform) |
+------------------+     +------------------+     +------------------+
                                                          |
                              +---------------------------+
                              v
                    +------------------+
                    |  DigitalOcean    |
                    |  REST API v2     |
                    +------------------+
                              |
         +--------------------+--------------------+
         v                    v                    v
   +-----------+       +-----------+       +-----------+
   |  Droplet  |       |  Firewall |       |  LoadBal  |
   |  Create   |       |  Manage   |       |  Manage   |
   +-----------+       +-----------+       +-----------+
         |
         v
   +------------------+     +------------------+
   |  Bootstrap Node  |---->|  Join Platform   |
   |  (cloud-init)    |     |  Cluster (Swarm) |
   +------------------+     +------------------+
```

## 1. DigitalOcean API Endpoints Needed

### 1.1 Droplet Management

| Operation | DO API Endpoint | Method | Purpose |
|-----------|-----------------|--------|---------|
| Create | `/v2/droplets` | POST | Provision new node |
| Delete | `/v2/droplets/{id}` | DELETE | Remove node |
| List | `/v2/droplets` | GET | Inventory |
| Get | `/v2/droplets/{id}` | GET | Status check |
| Resize | `/v2/droplets/{id}/actions` | POST | Scale vertically |
| Power | `/v2/droplets/{id}/actions` | POST | Start/stop/reboot |
| Snapshot | `/v2/droplets/{id}/actions` | POST | Backup |

### 1.2 Firewall Management

| Operation | DO API Endpoint | Method | Purpose |
|-----------|-----------------|--------|---------|
| Create | `/v2/firewalls` | POST | Create firewall |
| List | `/v2/firewalls` | GET | List firewalls |
| Get | `/v2/firewalls/{id}` | GET | Get firewall |
| Update | `/v2/firewalls/{id}` | PUT | Update rules |
| Delete | `/v2/firewalls/{id}` | DELETE | Remove firewall |
| Add Droplets | `/v2/firewalls/{id}/droplets` | POST | Assign droplets |

### 1.3 Load Balancer Management

| Operation | DO API Endpoint | Method | Purpose |
|-----------|-----------------|--------|---------|
| Create | `/v2/load_balancers` | POST | Create LB |
| List | `/v2/load_balancers` | GET | List LBs |
| Get | `/v2/load_balancers/{id}` | GET | Get LB |
| Update | `/v2/load_balancers/{id}` | PUT | Update config |
| Delete | `/v2/load_balancers/{id}` | DELETE | Remove LB |
| Add Droplets | `/v2/load_balancers/{id}/droplets` | POST | Add backends |

### 1.4 VPC/Networking

| Operation | DO API Endpoint | Method | Purpose |
|-----------|-----------------|--------|---------|
| Create VPC | `/v2/vpcs` | POST | Create private network |
| List VPCs | `/v2/vpcs` | GET | List VPCs |
| Get VPC | `/v2/vpcs/{id}` | GET | Get VPC |
| Reserved IP | `/v2/reserved_ips` | POST | Static IPs |

### 1.5 SSH Keys

| Operation | DO API Endpoint | Method | Purpose |
|-----------|-----------------|--------|---------|
| Create | `/v2/account/keys` | POST | Add SSH key |
| List | `/v2/account/keys` | GET | List keys |
| Get | `/v2/account/keys/{id}` | GET | Get key |
| Delete | `/v2/account/keys/{id}` | DELETE | Remove key |

---

## 2. Node Provisioning Workflow

### 2.1 Bootstrap Sequence

```
1. Admin triggers "Add Node" in UI
                |
                v
2. Platform creates node record (status: pending)
                |
                v
3. DO API: Create Droplet with cloud-init script
                |
                v
4. cloud-init executes:
   - Install Docker
   - Install Platform agent
   - Configure SSH keys
   - Join Docker Swarm
   - Register with Platform API
                |
                v
5. Platform receives heartbeat from new node
                |
                v
6. Update node record (status: online)
                |
                v
7. Recalculate pool capacity
```

### 2.2 Cloud-Init Bootstrap Script

```yaml
#cloud-config
package_update: true
package_upgrade: true

packages:
  - curl
  - wget
  - git
  - jq
  - unzip

write_files:
  - path: /etc/platform/node-config.json
    content: |
      {
        "poolId": "{{POOL_ID}}",
        "nodeId": "{{NODE_ID}}",
        "platformApiUrl": "{{PLATFORM_API_URL}}",
        "registrationToken": "{{REGISTRATION_TOKEN}}",
        "swarmJoinToken": "{{SWARM_JOIN_TOKEN}}",
        "swarmManagerIp": "{{SWARM_MANAGER_IP}}"
      }

runcmd:
  # Install Docker
  - curl -fsSL https://get.docker.com | sh
  - systemctl enable docker
  - systemctl start docker

  # Join Docker Swarm
  - |
    CONFIG=$(cat /etc/platform/node-config.json)
    MANAGER_IP=$(echo $CONFIG | jq -r '.swarmManagerIp')
    JOIN_TOKEN=$(echo $CONFIG | jq -r '.swarmJoinToken')
    docker swarm join --token $JOIN_TOKEN $MANAGER_IP:2377

  # Install Platform monitoring agent
  - |
    curl -sSL https://platform.hanzo.ai/install-agent.sh | bash

  # Register with Platform
  - |
    NODE_ID=$(echo $CONFIG | jq -r '.nodeId')
    API_URL=$(echo $CONFIG | jq -r '.platformApiUrl')
    TOKEN=$(echo $CONFIG | jq -r '.registrationToken')
    IP=$(curl -s https://ipinfo.io/ip)

    curl -X POST "$API_URL/api/nodes/$NODE_ID/register" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"ipAddress\": \"$IP\", \"hostname\": \"$(hostname)\"}"

final_message: "Platform node bootstrap complete"
```

### 2.3 Joining Platform Cluster

The node joins the existing Docker Swarm cluster as a worker:

```bash
# On manager node - get worker join token
docker swarm join-token worker -q

# On new droplet - join swarm
docker swarm join --token <token> <manager-ip>:2377
```

### 2.4 Deploying Apps to Nodes

Apps are deployed via Docker Swarm services with placement constraints:

```bash
# Deploy to specific node
docker service create \
  --name myapp \
  --constraint 'node.labels.pool==<pool-id>' \
  --constraint 'node.labels.type==gpu' \
  --replicas 2 \
  myapp:latest

# Update service to add replicas
docker service scale myapp=5
```

### 2.5 Node Drain/Removal Workflow

```
1. Admin triggers "Remove Node" in UI
                |
                v
2. Update node status to "draining"
                |
                v
3. Docker Swarm: drain node
   docker node update --availability drain <node-id>
                |
                v
4. Wait for workloads to migrate (poll containers)
                |
                v
5. Docker Swarm: remove node
   docker node rm <node-id>
                |
                v
6. DO API: Delete droplet
                |
                v
7. Delete node record from database
                |
                v
8. Recalculate pool capacity
```

---

## 3. Service Discovery Options

### 3.1 Recommended: Built-in Docker Swarm Service Discovery

For Platform's use case, Docker Swarm's built-in service discovery is the simplest and most appropriate solution:

**How it works:**
- Services are automatically discoverable by name within the overlay network
- Swarm's internal DNS resolves service names to VIPs
- Built-in load balancing across service replicas
- No additional infrastructure required

```yaml
# Services discover each other by name
services:
  web:
    image: myapp:web
    networks:
      - platform-network
  api:
    image: myapp:api
    environment:
      - DATABASE_URL=postgres://db:5432/app  # "db" is the service name
    networks:
      - platform-network
  db:
    image: ghcr.io/hanzoai/sql:18
    networks:
      - platform-network
```

**Pros:**
- Zero additional infrastructure
- Native to Docker Swarm
- Automatic failover
- No configuration needed

**Cons:**
- Limited to Swarm cluster
- No advanced features like health-based routing

### 3.2 Alternative: Traefik as Service Mesh

For more advanced routing, use Traefik (already deployed):

```yaml
# traefik labels for service discovery
services:
  myapp:
    image: myapp:latest
    deploy:
      labels:
        - "traefik.enable=true"
        - "traefik.http.routers.myapp.rule=Host(`myapp.example.com`)"
        - "traefik.http.services.myapp.loadbalancer.server.port=8080"
        - "traefik.http.services.myapp.loadbalancer.healthcheck.path=/health"
        - "traefik.http.services.myapp.loadbalancer.healthcheck.interval=10s"
```

### 3.3 Load Balancer Backend Updates

The Platform already manages Traefik configuration dynamically. For DO Load Balancers:

```typescript
// Update DO Load Balancer backends when nodes change
async function updateLoadBalancerBackends(
  lbId: string,
  dropletIds: number[]
): Promise<void> {
  await doClient.loadBalancers.addDroplets(lbId, { droplet_ids: dropletIds });
}

// Called when:
// - New node joins cluster
// - Node is removed
// - Node health changes
```

---

## 4. Admin Scaling UX

### 4.1 API Endpoint Design

```typescript
// pkg/platform/src/db/schema/digitalocean.ts

export const cloudProvider = pgTable("cloud_provider", {
  providerId: text("provider_id").primaryKey().$defaultFn(() => nanoid()),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  providerType: text("provider_type").notNull().default("digitalocean"), // digitalocean, aws, gcp
  name: text("name").notNull(),
  credentials: jsonb("credentials").$type<{
    apiToken?: string;  // encrypted
    region?: string;
    projectId?: string;
  }>(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const provisionedDroplet = pgTable("provisioned_droplet", {
  dropletId: text("droplet_id").primaryKey().$defaultFn(() => nanoid()),
  cloudProviderId: text("cloud_provider_id")
    .notNull()
    .references(() => cloudProvider.providerId, { onDelete: "cascade" }),
  computeNodeId: text("compute_node_id")
    .references(() => computeNode.nodeId, { onDelete: "set null" }),

  // DO-specific fields
  doDropletId: integer("do_droplet_id"),
  doDropletName: text("do_droplet_name").notNull(),
  doRegion: text("do_region").notNull(),
  doSize: text("do_size").notNull(), // s-1vcpu-1gb, etc.
  doImage: text("do_image").notNull().default("ubuntu-22-04-x64"),
  doVpcUuid: text("do_vpc_uuid"),
  doFirewallId: text("do_firewall_id"),

  // Status
  status: text("status").notNull().default("pending"), // pending, provisioning, running, draining, terminated
  publicIp: text("public_ip"),
  privateIp: text("private_ip"),

  // Metadata
  tags: text("tags").array().default(sql`ARRAY[]::text[]`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  terminatedAt: timestamp("terminated_at"),
});
```

### 4.2 tRPC Router Design

```typescript
// app/platform/server/api/routers/digitalocean.ts

import { z } from "zod";
import { createTRPCRouter, protectedProcedure, adminProcedure } from "../trpc";
import {
  createDroplet,
  deleteDroplet,
  resizeDroplet,
  listDroplets,
  getDropletStatus,
  drainNode,
} from "@hanzo/platform/services/digitalocean";

export const digitaloceanRouter = createTRPCRouter({
  // Provider configuration
  configureProvider: adminProcedure
    .input(z.object({
      name: z.string().min(1),
      apiToken: z.string().min(1),
      region: z.string().default("nyc1"),
      projectId: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return await configureDigitalOceanProvider(
        ctx.session.activeOrganizationId,
        input
      );
    }),

  // List available droplet sizes
  listSizes: protectedProcedure
    .input(z.object({
      providerId: z.string(),
      region: z.string().optional(),
    }))
    .query(async ({ input }) => {
      return await listDropletSizes(input.providerId, input.region);
    }),

  // List available regions
  listRegions: protectedProcedure
    .input(z.object({
      providerId: z.string(),
    }))
    .query(async ({ input }) => {
      return await listRegions(input.providerId);
    }),

  // Scale up - add new nodes
  scaleUp: adminProcedure
    .input(z.object({
      poolId: z.string().min(1),
      providerId: z.string().min(1),
      count: z.number().int().min(1).max(10),
      size: z.string().default("s-2vcpu-4gb"),
      region: z.string().default("nyc1"),
      nodeType: z.enum(["worker", "gpu", "storage"]).default("worker"),
      labels: z.record(z.string()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Returns job ID for tracking
      return await scaleUpPool(ctx.session.activeOrganizationId, input);
    }),

  // Scale down - remove nodes
  scaleDown: adminProcedure
    .input(z.object({
      poolId: z.string().min(1),
      count: z.number().int().min(1),
      strategy: z.enum(["oldest", "newest", "least-utilized"]).default("oldest"),
    }))
    .mutation(async ({ ctx, input }) => {
      return await scaleDownPool(ctx.session.activeOrganizationId, input);
    }),

  // Resize a specific node
  resizeNode: adminProcedure
    .input(z.object({
      dropletId: z.string().min(1),
      newSize: z.string().min(1),
      resizeDisk: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      return await resizeDroplet(input);
    }),

  // Drain node before removal
  drainNode: adminProcedure
    .input(z.object({
      nodeId: z.string().min(1),
      force: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      return await drainNode(input.nodeId, input.force);
    }),

  // Remove specific node
  removeNode: adminProcedure
    .input(z.object({
      dropletId: z.string().min(1),
      force: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      return await removeDroplet(input.dropletId, input.force);
    }),

  // Get scaling status
  getScalingStatus: protectedProcedure
    .input(z.object({
      poolId: z.string().min(1),
    }))
    .query(async ({ input }) => {
      return await getPoolScalingStatus(input.poolId);
    }),

  // List all droplets in pool
  listPoolDroplets: protectedProcedure
    .input(z.object({
      poolId: z.string().min(1),
    }))
    .query(async ({ input }) => {
      return await listPoolDroplets(input.poolId);
    }),

  // WebSocket subscription for real-time status
  onNodeStatusChange: protectedProcedure
    .input(z.object({
      poolId: z.string().min(1),
    }))
    .subscription(({ input }) => {
      return observable<NodeStatusEvent>((emit) => {
        // Subscribe to node status changes via Redis pub/sub
        const unsubscribe = subscribeToPoolEvents(input.poolId, (event) => {
          emit.next(event);
        });
        return () => unsubscribe();
      });
    }),
});
```

### 4.3 Service Layer Implementation

```typescript
// pkg/platform/src/services/digitalocean.ts

import createClient from "openapi-fetch";
import type { paths } from "@/types/digitalocean-api"; // generated from DO OpenAPI spec
import { db } from "@hanzo/platform/db";
import {
  cloudProvider,
  provisionedDroplet,
  computeNode,
  computePool,
} from "@hanzo/platform/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { encrypt, decrypt } from "@hanzo/platform/utils/crypto";
import { nanoid } from "nanoid";

interface DOClientConfig {
  apiToken: string;
}

function createDOClient(config: DOClientConfig) {
  return createClient<paths>({
    baseUrl: "https://api.digitalocean.com",
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      "Content-Type": "application/json",
    },
  });
}

// ============================================================================
// Provider Configuration
// ============================================================================

export async function configureDigitalOceanProvider(
  organizationId: string,
  config: {
    name: string;
    apiToken: string;
    region: string;
    projectId?: string;
  }
) {
  // Validate token by making test API call
  const client = createDOClient({ apiToken: config.apiToken });
  const { data, error } = await client.GET("/v2/account");

  if (error) {
    throw new Error("Invalid DigitalOcean API token");
  }

  // Store encrypted credentials
  const provider = await db.insert(cloudProvider).values({
    organizationId,
    providerType: "digitalocean",
    name: config.name,
    credentials: {
      apiToken: await encrypt(config.apiToken),
      region: config.region,
      projectId: config.projectId,
    },
  }).returning();

  return provider[0];
}

// ============================================================================
// Droplet Management
// ============================================================================

export async function createDroplet(
  providerId: string,
  config: {
    poolId: string;
    name: string;
    size: string;
    region: string;
    nodeType: string;
    labels?: Record<string, string>;
  }
): Promise<string> {
  const provider = await getProvider(providerId);
  const client = createDOClient({
    apiToken: await decrypt(provider.credentials.apiToken)
  });

  // Generate registration token for bootstrap
  const nodeId = nanoid();
  const registrationToken = nanoid(32);

  // Get swarm join token from manager
  const pool = await db.query.computePool.findFirst({
    where: eq(computePool.poolId, config.poolId),
  });

  // Build cloud-init script
  const cloudInit = buildCloudInitScript({
    nodeId,
    poolId: config.poolId,
    registrationToken,
    swarmManagerIp: pool?.networkAddress || "",
    platformApiUrl: process.env.PLATFORM_API_URL || "",
  });

  // Create droplet via DO API
  const { data, error } = await client.POST("/v2/droplets", {
    body: {
      name: config.name,
      region: config.region,
      size: config.size,
      image: "ubuntu-22-04-x64",
      ssh_keys: await getSSHKeyIds(providerId),
      user_data: cloudInit,
      tags: [
        `pool:${config.poolId}`,
        `type:${config.nodeType}`,
        ...Object.entries(config.labels || {}).map(([k, v]) => `${k}:${v}`),
      ],
      vpc_uuid: await getVPCId(providerId, config.region),
      with_droplet_agent: true,
    },
  });

  if (error) {
    throw new Error(`Failed to create droplet: ${JSON.stringify(error)}`);
  }

  // Create database records
  await Promise.all([
    // Create compute node record (pending)
    db.insert(computeNode).values({
      nodeId,
      poolId: config.poolId,
      name: config.name,
      region: config.region,
      nodeType: config.nodeType as any,
      status: "offline",
      cpuCores: getDropletSpecs(config.size).cpuCores,
      memoryMb: getDropletSpecs(config.size).memoryMb,
      storageGb: getDropletSpecs(config.size).storageGb,
    }),

    // Create provisioned droplet record
    db.insert(provisionedDroplet).values({
      cloudProviderId: providerId,
      computeNodeId: nodeId,
      doDropletId: data.droplet.id,
      doDropletName: config.name,
      doRegion: config.region,
      doSize: config.size,
      status: "provisioning",
      tags: data.droplet.tags,
    }),
  ]);

  // Store registration token for bootstrap verification
  await storeRegistrationToken(nodeId, registrationToken);

  return nodeId;
}

export async function deleteDroplet(
  dropletId: string,
  force: boolean = false
): Promise<void> {
  const droplet = await db.query.provisionedDroplet.findFirst({
    where: eq(provisionedDroplet.dropletId, dropletId),
    with: { computeNode: true },
  });

  if (!droplet) {
    throw new Error("Droplet not found");
  }

  // Drain node first unless force=true
  if (!force && droplet.computeNodeId) {
    await drainNode(droplet.computeNodeId, false);
  }

  // Get DO client
  const provider = await getProvider(droplet.cloudProviderId);
  const client = createDOClient({
    apiToken: await decrypt(provider.credentials.apiToken),
  });

  // Delete droplet from DO
  const { error } = await client.DELETE("/v2/droplets/{droplet_id}", {
    params: { path: { droplet_id: droplet.doDropletId } },
  });

  if (error) {
    throw new Error(`Failed to delete droplet: ${JSON.stringify(error)}`);
  }

  // Remove from Docker Swarm
  if (droplet.computeNodeId) {
    await removeNodeFromSwarm(droplet.computeNodeId);
  }

  // Update database
  await db.update(provisionedDroplet)
    .set({
      status: "terminated",
      terminatedAt: new Date(),
    })
    .where(eq(provisionedDroplet.dropletId, dropletId));

  // Delete compute node record
  if (droplet.computeNodeId) {
    await db.delete(computeNode)
      .where(eq(computeNode.nodeId, droplet.computeNodeId));
  }

  // Recalculate pool capacity
  await recalculatePoolCapacity(droplet.computeNode?.poolId);
}

export async function resizeDroplet(config: {
  dropletId: string;
  newSize: string;
  resizeDisk: boolean;
}): Promise<void> {
  const droplet = await db.query.provisionedDroplet.findFirst({
    where: eq(provisionedDroplet.dropletId, config.dropletId),
  });

  if (!droplet) {
    throw new Error("Droplet not found");
  }

  const provider = await getProvider(droplet.cloudProviderId);
  const client = createDOClient({
    apiToken: await decrypt(provider.credentials.apiToken),
  });

  // Power off first (required for resize)
  await client.POST("/v2/droplets/{droplet_id}/actions", {
    params: { path: { droplet_id: droplet.doDropletId } },
    body: { type: "power_off" },
  });

  // Wait for power off
  await waitForDropletStatus(client, droplet.doDropletId, "off");

  // Resize
  const { error } = await client.POST("/v2/droplets/{droplet_id}/actions", {
    params: { path: { droplet_id: droplet.doDropletId } },
    body: {
      type: "resize",
      size: config.newSize,
      disk: config.resizeDisk,
    },
  });

  if (error) {
    throw new Error(`Failed to resize droplet: ${JSON.stringify(error)}`);
  }

  // Power back on
  await client.POST("/v2/droplets/{droplet_id}/actions", {
    params: { path: { droplet_id: droplet.doDropletId } },
    body: { type: "power_on" },
  });

  // Update database
  await db.update(provisionedDroplet)
    .set({ doSize: config.newSize })
    .where(eq(provisionedDroplet.dropletId, config.dropletId));

  // Update compute node specs
  if (droplet.computeNodeId) {
    const specs = getDropletSpecs(config.newSize);
    await db.update(computeNode)
      .set({
        cpuCores: specs.cpuCores,
        memoryMb: specs.memoryMb,
        storageGb: specs.storageGb,
      })
      .where(eq(computeNode.nodeId, droplet.computeNodeId));
  }
}

// ============================================================================
// Scaling Operations
// ============================================================================

export async function scaleUpPool(
  organizationId: string,
  config: {
    poolId: string;
    providerId: string;
    count: number;
    size: string;
    region: string;
    nodeType: string;
    labels?: Record<string, string>;
  }
): Promise<{ jobId: string; nodeIds: string[] }> {
  const jobId = nanoid();
  const nodeIds: string[] = [];

  // Create nodes in parallel
  const createPromises = Array.from({ length: config.count }, async (_, i) => {
    const name = `platform-${config.poolId.slice(0, 8)}-${nanoid(6)}`;
    const nodeId = await createDroplet(config.providerId, {
      poolId: config.poolId,
      name,
      size: config.size,
      region: config.region,
      nodeType: config.nodeType,
      labels: config.labels,
    });
    nodeIds.push(nodeId);
    return nodeId;
  });

  // Execute in batches of 5 to avoid rate limits
  const batchSize = 5;
  for (let i = 0; i < createPromises.length; i += batchSize) {
    const batch = createPromises.slice(i, i + batchSize);
    await Promise.all(batch);
  }

  // Emit scaling event
  await emitPoolEvent(config.poolId, {
    type: "scale_up",
    jobId,
    nodeIds,
    status: "in_progress",
  });

  return { jobId, nodeIds };
}

export async function scaleDownPool(
  organizationId: string,
  config: {
    poolId: string;
    count: number;
    strategy: "oldest" | "newest" | "least-utilized";
  }
): Promise<{ jobId: string; nodeIds: string[] }> {
  // Select nodes to remove based on strategy
  let orderBy;
  switch (config.strategy) {
    case "newest":
      orderBy = desc(computeNode.createdAt);
      break;
    case "least-utilized":
      orderBy = computeNode.cpuUtilizationPercent;
      break;
    default: // oldest
      orderBy = computeNode.createdAt;
  }

  const nodesToRemove = await db.query.computeNode.findMany({
    where: eq(computeNode.poolId, config.poolId),
    orderBy,
    limit: config.count,
    with: {
      provisionedDroplets: true,
    },
  });

  const jobId = nanoid();
  const nodeIds = nodesToRemove.map(n => n.nodeId);

  // Drain and remove in parallel
  await Promise.all(
    nodesToRemove.map(async (node) => {
      const droplet = node.provisionedDroplets?.[0];
      if (droplet) {
        await deleteDroplet(droplet.dropletId, false);
      }
    })
  );

  return { jobId, nodeIds };
}

// ============================================================================
// Node Management
// ============================================================================

export async function drainNode(
  nodeId: string,
  force: boolean = false
): Promise<void> {
  const node = await db.query.computeNode.findFirst({
    where: eq(computeNode.nodeId, nodeId),
    with: { pool: true },
  });

  if (!node) {
    throw new Error("Node not found");
  }

  // Update status
  await db.update(computeNode)
    .set({ status: "draining" })
    .where(eq(computeNode.nodeId, nodeId));

  // Get Docker node ID and drain via Swarm
  const serverId = node.pool?.networkAddress; // Manager server
  if (serverId) {
    const dockerNodeId = await getDockerNodeId(nodeId, serverId);

    if (force) {
      // Force remove all containers
      await execAsyncRemote(
        serverId,
        `docker node update --availability drain ${dockerNodeId}`
      );
    } else {
      // Graceful drain - wait for containers to migrate
      await execAsyncRemote(
        serverId,
        `docker node update --availability drain ${dockerNodeId}`
      );

      // Wait for all tasks to migrate (max 5 minutes)
      await waitForNodeDrain(serverId, dockerNodeId, 300);
    }
  }
}

async function removeNodeFromSwarm(nodeId: string): Promise<void> {
  const node = await db.query.computeNode.findFirst({
    where: eq(computeNode.nodeId, nodeId),
    with: { pool: true },
  });

  if (!node?.pool?.networkAddress) return;

  const serverId = node.pool.networkAddress;
  const dockerNodeId = await getDockerNodeId(nodeId, serverId);

  // Force remove from swarm
  await execAsyncRemote(
    serverId,
    `docker node rm --force ${dockerNodeId}`
  );
}

// ============================================================================
// Firewall Management
// ============================================================================

export async function createPoolFirewall(
  providerId: string,
  poolId: string
): Promise<string> {
  const provider = await getProvider(providerId);
  const client = createDOClient({
    apiToken: await decrypt(provider.credentials.apiToken),
  });

  const { data, error } = await client.POST("/v2/firewalls", {
    body: {
      name: `platform-${poolId.slice(0, 8)}`,
      inbound_rules: [
        // SSH
        { protocol: "tcp", ports: "22", sources: { addresses: ["0.0.0.0/0"] } },
        // Docker Swarm ports
        { protocol: "tcp", ports: "2377", sources: { tags: [`pool:${poolId}`] } },
        { protocol: "tcp", ports: "7946", sources: { tags: [`pool:${poolId}`] } },
        { protocol: "udp", ports: "7946", sources: { tags: [`pool:${poolId}`] } },
        { protocol: "udp", ports: "4789", sources: { tags: [`pool:${poolId}`] } },
        // HTTP/HTTPS
        { protocol: "tcp", ports: "80", sources: { addresses: ["0.0.0.0/0"] } },
        { protocol: "tcp", ports: "443", sources: { addresses: ["0.0.0.0/0"] } },
        // Platform monitoring
        { protocol: "tcp", ports: "4500", sources: { tags: [`pool:${poolId}`] } },
      ],
      outbound_rules: [
        { protocol: "tcp", ports: "all", destinations: { addresses: ["0.0.0.0/0"] } },
        { protocol: "udp", ports: "all", destinations: { addresses: ["0.0.0.0/0"] } },
        { protocol: "icmp", destinations: { addresses: ["0.0.0.0/0"] } },
      ],
      tags: [`pool:${poolId}`],
    },
  });

  if (error) {
    throw new Error(`Failed to create firewall: ${JSON.stringify(error)}`);
  }

  return data.firewall.id;
}

// ============================================================================
// Load Balancer Management
// ============================================================================

export async function createPoolLoadBalancer(
  providerId: string,
  poolId: string,
  config: {
    region: string;
    algorithm?: "round_robin" | "least_connections";
    healthCheck?: {
      protocol: "http" | "https" | "tcp";
      port: number;
      path?: string;
    };
  }
): Promise<string> {
  const provider = await getProvider(providerId);
  const client = createDOClient({
    apiToken: await decrypt(provider.credentials.apiToken),
  });

  // Get all droplets in pool
  const droplets = await db.query.provisionedDroplet.findMany({
    where: eq(provisionedDroplet.status, "running"),
    with: { computeNode: true },
  });

  const dropletIds = droplets
    .filter(d => d.computeNode?.poolId === poolId)
    .map(d => d.doDropletId);

  const { data, error } = await client.POST("/v2/load_balancers", {
    body: {
      name: `platform-lb-${poolId.slice(0, 8)}`,
      region: config.region,
      algorithm: config.algorithm || "round_robin",
      forwarding_rules: [
        {
          entry_protocol: "https",
          entry_port: 443,
          target_protocol: "http",
          target_port: 80,
          tls_passthrough: false,
        },
        {
          entry_protocol: "http",
          entry_port: 80,
          target_protocol: "http",
          target_port: 80,
        },
      ],
      health_check: {
        protocol: config.healthCheck?.protocol || "http",
        port: config.healthCheck?.port || 80,
        path: config.healthCheck?.path || "/health",
        check_interval_seconds: 10,
        response_timeout_seconds: 5,
        unhealthy_threshold: 3,
        healthy_threshold: 5,
      },
      droplet_ids: dropletIds,
      tag: `pool:${poolId}`,
      redirect_http_to_https: true,
      enable_proxy_protocol: false,
      enable_backend_keepalive: true,
    },
  });

  if (error) {
    throw new Error(`Failed to create load balancer: ${JSON.stringify(error)}`);
  }

  return data.load_balancer.id;
}

export async function updateLoadBalancerDroplets(
  providerId: string,
  lbId: string,
  dropletIds: number[]
): Promise<void> {
  const provider = await getProvider(providerId);
  const client = createDOClient({
    apiToken: await decrypt(provider.credentials.apiToken),
  });

  // Get current LB config
  const { data: lb } = await client.GET("/v2/load_balancers/{lb_id}", {
    params: { path: { lb_id: lbId } },
  });

  // Update with new droplet list
  await client.PUT("/v2/load_balancers/{lb_id}", {
    params: { path: { lb_id: lbId } },
    body: {
      ...lb.load_balancer,
      droplet_ids: dropletIds,
    },
  });
}

// ============================================================================
// Helper Functions
// ============================================================================

function buildCloudInitScript(config: {
  nodeId: string;
  poolId: string;
  registrationToken: string;
  swarmManagerIp: string;
  platformApiUrl: string;
}): string {
  return `#cloud-config
package_update: true
package_upgrade: true

packages:
  - curl
  - wget
  - git
  - jq
  - unzip

write_files:
  - path: /etc/platform/node-config.json
    permissions: '0600'
    content: |
      {
        "nodeId": "${config.nodeId}",
        "poolId": "${config.poolId}",
        "platformApiUrl": "${config.platformApiUrl}",
        "registrationToken": "${config.registrationToken}",
        "swarmManagerIp": "${config.swarmManagerIp}"
      }

runcmd:
  - curl -fsSL https://get.docker.com | sh
  - systemctl enable docker
  - systemctl start docker
  - |
    CONFIG=\$(cat /etc/platform/node-config.json)
    MANAGER_IP=\$(echo \$CONFIG | jq -r '.swarmManagerIp')
    if [ -n "\$MANAGER_IP" ] && [ "\$MANAGER_IP" != "null" ]; then
      # Get join token from Platform API
      TOKEN=\$(echo \$CONFIG | jq -r '.registrationToken')
      API_URL=\$(echo \$CONFIG | jq -r '.platformApiUrl')
      JOIN_TOKEN=\$(curl -s "\$API_URL/api/pools/\$(echo \$CONFIG | jq -r '.poolId')/join-token" -H "Authorization: Bearer \$TOKEN" | jq -r '.token')
      docker swarm join --token \$JOIN_TOKEN \$MANAGER_IP:2377
    fi
  - |
    CONFIG=\$(cat /etc/platform/node-config.json)
    NODE_ID=\$(echo \$CONFIG | jq -r '.nodeId')
    API_URL=\$(echo \$CONFIG | jq -r '.platformApiUrl')
    TOKEN=\$(echo \$CONFIG | jq -r '.registrationToken')
    IP=\$(curl -s https://ipinfo.io/ip)
    PRIVATE_IP=\$(hostname -I | awk '{print \$1}')
    curl -X POST "\$API_URL/api/nodes/\$NODE_ID/register" \\
      -H "Authorization: Bearer \$TOKEN" \\
      -H "Content-Type: application/json" \\
      -d "{\\"publicIp\\": \\"\$IP\\", \\"privateIp\\": \\"\$PRIVATE_IP\\", \\"hostname\\": \\"\$(hostname)\\"}"

final_message: "Platform node bootstrap complete"`;
}

function getDropletSpecs(size: string): {
  cpuCores: number;
  memoryMb: number;
  storageGb: number;
} {
  // DO size format: s-{vcpus}vcpu-{memory}gb or similar
  const sizeMap: Record<string, { cpuCores: number; memoryMb: number; storageGb: number }> = {
    "s-1vcpu-512mb-10gb": { cpuCores: 1, memoryMb: 512, storageGb: 10 },
    "s-1vcpu-1gb": { cpuCores: 1, memoryMb: 1024, storageGb: 25 },
    "s-1vcpu-2gb": { cpuCores: 1, memoryMb: 2048, storageGb: 50 },
    "s-2vcpu-2gb": { cpuCores: 2, memoryMb: 2048, storageGb: 60 },
    "s-2vcpu-4gb": { cpuCores: 2, memoryMb: 4096, storageGb: 80 },
    "s-4vcpu-8gb": { cpuCores: 4, memoryMb: 8192, storageGb: 160 },
    "s-8vcpu-16gb": { cpuCores: 8, memoryMb: 16384, storageGb: 320 },
    "g-2vcpu-8gb": { cpuCores: 2, memoryMb: 8192, storageGb: 25 }, // GPU
    "g-4vcpu-16gb": { cpuCores: 4, memoryMb: 16384, storageGb: 50 }, // GPU
    // Add more as needed
  };
  return sizeMap[size] || { cpuCores: 1, memoryMb: 1024, storageGb: 25 };
}

async function recalculatePoolCapacity(poolId: string | undefined): Promise<void> {
  if (!poolId) return;

  const nodes = await db.query.computeNode.findMany({
    where: and(
      eq(computeNode.poolId, poolId),
      eq(computeNode.status, "online")
    ),
  });

  const totals = nodes.reduce(
    (acc, node) => ({
      cpuCores: acc.cpuCores + node.cpuCores,
      memoryMb: acc.memoryMb + node.memoryMb,
      storageGb: acc.storageGb + node.storageGb,
      gpuCount: acc.gpuCount + (node.gpuCount || 0),
    }),
    { cpuCores: 0, memoryMb: 0, storageGb: 0, gpuCount: 0 }
  );

  await db.update(computePool)
    .set({
      totalCpuCores: totals.cpuCores,
      totalMemoryMb: totals.memoryMb,
      totalStorageGb: totals.storageGb,
      totalGpuCount: totals.gpuCount,
      totalNodes: nodes.length,
      activeNodes: nodes.length,
      updatedAt: new Date(),
    })
    .where(eq(computePool.poolId, poolId));
}
```

### 4.4 UI Components

```typescript
// app/platform/components/dashboard/cloud-provider/ScalePoolDialog.tsx

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { api } from "@/utils/api";
import { toast } from "sonner";
import { Plus, Minus, Loader2 } from "lucide-react";

const scaleSchema = z.object({
  direction: z.enum(["up", "down"]),
  count: z.number().min(1).max(10),
  size: z.string().optional(),
  region: z.string().optional(),
  nodeType: z.enum(["worker", "gpu", "storage"]).optional(),
});

interface ScalePoolDialogProps {
  poolId: string;
  providerId: string;
  currentNodes: number;
}

export function ScalePoolDialog({
  poolId,
  providerId,
  currentNodes,
}: ScalePoolDialogProps) {
  const [open, setOpen] = useState(false);
  const [isScaling, setIsScaling] = useState(false);

  const utils = api.useContext();

  const { data: sizes } = api.digitalocean.listSizes.useQuery({ providerId });
  const { data: regions } = api.digitalocean.listRegions.useQuery({ providerId });

  const scaleUpMutation = api.digitalocean.scaleUp.useMutation({
    onSuccess: () => {
      toast.success("Scaling operation started");
      utils.digitalocean.listPoolDroplets.invalidate({ poolId });
      setOpen(false);
    },
    onError: (error) => {
      toast.error(`Scaling failed: ${error.message}`);
    },
  });

  const scaleDownMutation = api.digitalocean.scaleDown.useMutation({
    onSuccess: () => {
      toast.success("Scaling down started");
      utils.digitalocean.listPoolDroplets.invalidate({ poolId });
      setOpen(false);
    },
    onError: (error) => {
      toast.error(`Scale down failed: ${error.message}`);
    },
  });

  const form = useForm<z.infer<typeof scaleSchema>>({
    resolver: zodResolver(scaleSchema),
    defaultValues: {
      direction: "up",
      count: 1,
      size: "s-2vcpu-4gb",
      region: "nyc1",
      nodeType: "worker",
    },
  });

  const direction = form.watch("direction");

  async function onSubmit(values: z.infer<typeof scaleSchema>) {
    setIsScaling(true);
    try {
      if (values.direction === "up") {
        await scaleUpMutation.mutateAsync({
          poolId,
          providerId,
          count: values.count,
          size: values.size!,
          region: values.region!,
          nodeType: values.nodeType!,
        });
      } else {
        await scaleDownMutation.mutateAsync({
          poolId,
          count: values.count,
          strategy: "oldest",
        });
      }
    } finally {
      setIsScaling(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Scale Pool
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Scale Compute Pool</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="direction"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Direction</FormLabel>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant={field.value === "up" ? "default" : "outline"}
                      onClick={() => field.onChange("up")}
                      className="flex-1"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Scale Up
                    </Button>
                    <Button
                      type="button"
                      variant={field.value === "down" ? "default" : "outline"}
                      onClick={() => field.onChange("down")}
                      className="flex-1"
                    >
                      <Minus className="w-4 h-4 mr-2" />
                      Scale Down
                    </Button>
                  </div>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="count"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Number of Nodes ({currentNodes} current)
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      max={direction === "down" ? currentNodes : 10}
                      {...field}
                      onChange={(e) => field.onChange(parseInt(e.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {direction === "up" && (
              <>
                <FormField
                  control={form.control}
                  name="size"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Droplet Size</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select size" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {sizes?.map((size) => (
                            <SelectItem key={size.slug} value={size.slug}>
                              {size.slug} - ${size.price_monthly}/mo
                              ({size.vcpus} vCPU, {size.memory / 1024}GB RAM)
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="region"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Region</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select region" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {regions?.map((region) => (
                            <SelectItem key={region.slug} value={region.slug}>
                              {region.name} ({region.slug})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="nodeType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Node Type</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="worker">Worker</SelectItem>
                          <SelectItem value="gpu">GPU</SelectItem>
                          <SelectItem value="storage">Storage</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}

            <Button type="submit" className="w-full" disabled={isScaling}>
              {isScaling && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {direction === "up" ? "Add Nodes" : "Remove Nodes"}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
```

### 4.5 Real-Time Status Updates

```typescript
// app/platform/components/dashboard/cloud-provider/NodeStatusMonitor.tsx

import { useEffect, useState } from "react";
import { api } from "@/utils/api";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Server, Cpu, HardDrive, Wifi } from "lucide-react";

interface NodeStatusMonitorProps {
  poolId: string;
}

export function NodeStatusMonitor({ poolId }: NodeStatusMonitorProps) {
  const { data: droplets, isLoading } = api.digitalocean.listPoolDroplets.useQuery(
    { poolId },
    { refetchInterval: 10000 } // Poll every 10 seconds
  );

  // WebSocket subscription for real-time updates
  api.digitalocean.onNodeStatusChange.useSubscription(
    { poolId },
    {
      onData: (event) => {
        // Handle real-time status updates
        console.log("Node status update:", event);
      },
    }
  );

  if (isLoading) {
    return <div>Loading nodes...</div>;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {droplets?.map((droplet) => (
        <Card key={droplet.dropletId}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Server className="w-4 h-4" />
                {droplet.doDropletName}
              </span>
              <NodeStatusBadge status={droplet.status} />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Region</span>
              <span>{droplet.doRegion}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Size</span>
              <span>{droplet.doSize}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">IP</span>
              <span className="font-mono text-xs">{droplet.publicIp}</span>
            </div>

            {droplet.computeNode && (
              <>
                <div className="pt-2 border-t">
                  <div className="flex items-center gap-2 text-sm mb-1">
                    <Cpu className="w-3 h-3" />
                    <span>CPU</span>
                    <span className="ml-auto">
                      {droplet.computeNode.cpuUtilizationPercent}%
                    </span>
                  </div>
                  <Progress
                    value={parseFloat(droplet.computeNode.cpuUtilizationPercent)}
                  />
                </div>
                <div>
                  <div className="flex items-center gap-2 text-sm mb-1">
                    <HardDrive className="w-3 h-3" />
                    <span>Memory</span>
                    <span className="ml-auto">
                      {droplet.computeNode.memoryUtilizationPercent}%
                    </span>
                  </div>
                  <Progress
                    value={parseFloat(droplet.computeNode.memoryUtilizationPercent)}
                  />
                </div>
              </>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function NodeStatusBadge({ status }: { status: string }) {
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    running: "default",
    provisioning: "secondary",
    draining: "outline",
    terminated: "destructive",
    pending: "secondary",
  };

  return (
    <Badge variant={variants[status] || "secondary"}>
      {status}
    </Badge>
  );
}
```

---

## 5. Implementation Plan

### Phase 1: Foundation (Week 1)
1. Create database schema for cloud providers and droplets
2. Implement DigitalOcean API client with TypeScript types
3. Build credential management with encryption
4. Create basic tRPC router structure

### Phase 2: Core Provisioning (Week 2)
1. Implement droplet creation with cloud-init
2. Build node registration endpoint
3. Implement swarm join logic
4. Add firewall management

### Phase 3: Scaling Operations (Week 3)
1. Implement scale up/down mutations
2. Build node drain workflow
3. Add load balancer integration
4. Implement capacity recalculation

### Phase 4: UI & Monitoring (Week 4)
1. Build admin scaling dialog
2. Create node status monitor
3. Add WebSocket real-time updates
4. Implement cost estimation display

### Phase 5: Testing & Hardening (Week 5)
1. Integration tests with DO API
2. Load testing scale operations
3. Failure recovery testing
4. Documentation and runbooks

---

## 6. File Structure

```
platform/
├── pkg/platform/src/
│   ├── db/schema/
│   │   ├── cloud-provider.ts       # NEW: Cloud provider schema
│   │   └── index.ts                # Export new schemas
│   ├── services/
│   │   ├── digitalocean.ts         # NEW: DO API service
│   │   └── cloud-provider.ts       # NEW: Provider abstraction
│   └── utils/
│       └── crypto.ts               # NEW: Encryption utils
├── app/platform/
│   ├── server/api/routers/
│   │   └── digitalocean.ts         # NEW: tRPC router
│   ├── components/dashboard/
│   │   └── cloud-provider/
│   │       ├── ScalePoolDialog.tsx # NEW
│   │       ├── NodeStatusMonitor.tsx # NEW
│   │       └── ProviderConfig.tsx  # NEW
│   └── pages/dashboard/
│       └── cloud/
│           └── [poolId].tsx        # NEW: Pool management page
└── docs/
    └── DIGITALOCEAN_INTEGRATION_DESIGN.md  # This document
```

---

## 7. Security Considerations

1. **API Token Storage**: Encrypt DO API tokens at rest using AES-256
2. **Registration Tokens**: One-time use, expire after 1 hour
3. **Firewall Rules**: Restrict inter-node traffic to VPC only
4. **SSH Keys**: Platform manages SSH keys, never exposed to UI
5. **Audit Logging**: Log all scaling operations with user attribution
6. **Rate Limiting**: Implement DO API rate limit handling with exponential backoff

---

## 8. Cost Management

```typescript
// Estimated costs for common configurations
const DROPLET_COSTS = {
  "s-1vcpu-1gb": 6,      // $6/month
  "s-2vcpu-4gb": 24,     // $24/month
  "s-4vcpu-8gb": 48,     // $48/month
  "s-8vcpu-16gb": 96,    // $96/month
  "g-2vcpu-8gb": 70,     // GPU: $70/month
};

// Load Balancer: $12/month base + $0.01/10k requests
// Firewall: Free
// VPC: Free
// Reserved IP: $5/month (only when not attached)
```

---

## 9. References

- [DigitalOcean API v2 Documentation](https://docs.digitalocean.com/reference/api/api-reference/)
- [Docker Swarm Mode](https://docs.docker.com/engine/swarm/)
- [Cloud-Init Documentation](https://cloudinit.readthedocs.io/)
- [Platform Compute Pool Schema](./COMPUTE_SCHEMA_DESIGN.md)
