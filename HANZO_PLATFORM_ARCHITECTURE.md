# Hanzo Platform Architecture

## Overview

The Hanzo Platform is a comprehensive deployment and management system that integrates with Hanzo's blockchain infrastructure and provides unified authentication across all Hanzo properties.

## Key Components

### 1. Blockchain Infrastructure Integration

Instead of traditional Docker Compose deployments, the platform uses Hanzo's blockchain nodes for application deployment:

```
┌─────────────────────────────────────────────────────┐
│                  Hanzo Platform                      │
│                                                      │
│  ┌──────────────┐    ┌────────────────────────┐    │
│  │ Compose Editor│───▶│ Blockchain Deployment  │    │
│  │  (ReactFlow) │    │      Service           │    │
│  └──────────────┘    └─────────┬──────────────┘    │
│                                │                     │
└────────────────────────────────┼─────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │   Hanzo Blockchain      │
                    │      Infrastructure     │
                    ├─────────────────────────┤
                    │ • Validator Nodes       │
                    │ • Worker Nodes          │
                    │ • Storage Nodes         │
                    └─────────────────────────┘
```

**Key Files:**
- `/app/platform/lib/hanzo-blockchain-infra.ts` - Blockchain deployment service
- `/app/platform/components/compose-editor/` - Visual compose editor

### 2. Hanzo IAM Integration

Unified authentication across all Hanzo properties:

```
┌─────────────────────┐     ┌─────────────────────┐
│  platform.hanzo.ai  │────▶│                     │
├─────────────────────┤     │                     │
│   cloud.hanzo.ai    │────▶│    Hanzo IAM       │
├─────────────────────┤     │   (~/work/hanzo/   │
│     hanzo.app       │────▶│      iam)          │
├─────────────────────┤     │                     │
│    Other Apps       │────▶│                     │
└─────────────────────┘     └─────────────────────┘
```

**Features:**
- Single Sign-On (SSO) across all properties
- OAuth2 provider integration
- Organization and permission management
- Cross-subdomain cookie sharing

**Key Files:**
- `/app/platform/lib/hanzo-iam.ts` - IAM integration service

### 3. ReactFlow Compose Editor

A modern visual editor for Docker Compose specifications:

**Features:**
- Drag-and-drop service creation
- Visual dependency management
- Network and volume configuration
- Real-time YAML preview
- Import/Export capabilities
- Direct deployment to blockchain nodes

**Components:**
- `ComposeFlowEditor.tsx` - Main editor component
- `ServiceNode.tsx` - Service visualization
- `NetworkNode.tsx` - Network visualization
- `VolumeNode.tsx` - Volume visualization

### 4. Full Multi-Node Support

All features are enabled for internal Hanzo use:

- **Cluster Management** - Full access to cluster settings
- **Server Management** - Manage multiple servers
- **Docker Swarm** - Swarm mode configuration
- **Multi-Region Deployment** - Deploy across regions

## Deployment Architecture

### Local Development
```bash
# Start with full features enabled
HANZO_IAM_ENABLED=true
HANZO_BLOCKCHAIN_NODES=[{"id":"node-1","endpoint":"https://node1.hanzo.ai"}]
pnpm dev
```

### Production Deployment
```bash
# Deploy to Hanzo infrastructure
docker build -t hanzo-platform .
docker run -d \
  -e HANZO_IAM_ENDPOINT=https://iam.hanzo.ai \
  -e HANZO_NODE_API_KEY=${NODE_API_KEY} \
  -p 3000:3000 \
  hanzo-platform
```

## API Endpoints

### Deployment APIs
- `POST /api/deploy/blockchain` - Deploy to blockchain node
- `GET /api/deployments/{id}` - Get deployment status
- `DELETE /api/deployments/{id}` - Remove deployment
- `GET /api/nodes` - List available blockchain nodes

### Authentication APIs
- `GET /api/auth/login` - Redirect to Hanzo IAM
- `GET /api/auth/callback` - Handle IAM callback
- `POST /api/auth/logout` - Logout from IAM
- `GET /api/auth/sso/{app}` - SSO to other Hanzo apps

### Compose Editor APIs
- `POST /api/compose/validate` - Validate compose spec
- `POST /api/compose/convert` - Convert between formats
- `GET /api/compose/templates` - Get compose templates

## Environment Configuration

```bash
# Hanzo IAM Configuration
HANZO_IAM_ENDPOINT=https://iam.hanzo.ai
HANZO_IAM_CLIENT_ID=platform-client-id
HANZO_IAM_CLIENT_SECRET=platform-client-secret
HANZO_IAM_REDIRECT_URI=https://platform.hanzo.ai/auth/callback

# Blockchain Infrastructure
HANZO_BLOCKCHAIN_NODES=[...]
HANZO_NODE_API_KEY=your-node-api-key

# Platform Configuration
DATABASE_URL=postgresql://postgres:password@localhost:5432/platform
REDIS_URL=redis://localhost:6379

# Feature Flags (all enabled for internal use)
ENABLE_MULTI_NODE=true
ENABLE_CLUSTER_MANAGEMENT=true
ENABLE_SWARM_MODE=true
ENABLE_BLOCKCHAIN_DEPLOYMENT=true
```

## Security Considerations

1. **Authentication**: All requests validated through Hanzo IAM
2. **Authorization**: Permission-based access control
3. **Network**: Secure communication with blockchain nodes
4. **Secrets**: Managed through Hanzo's secret management

## Migration from Dokploy

### Removed Components
- Dokploy's broken Docker Compose implementation
- Commercial restrictions on multi-node features
- Dokploy branding and documentation links

### Added Components
- Hanzo blockchain infrastructure integration
- Hanzo IAM authentication
- ReactFlow-based compose editor
- Full Compose Spec v3.0 support

## Development Workflow

1. **Clone and Setup**
```bash
git clone https://github.com/hanzoai/platform
cd platform
pnpm install
```

2. **Configure Environment**
```bash
cp .env.example .env
# Edit .env with Hanzo credentials
```

3. **Start Development**
```bash
pnpm dev
```

4. **Access Platform**
- Local: http://localhost:3000
- Production: https://platform.hanzo.ai

## Support

- Internal Documentation: ~/work/hanzo/docs
- IAM Integration: ~/work/hanzo/iam
- Blockchain Nodes: ~/work/lux/
- Cloud Console: ~/work/lux/cloud