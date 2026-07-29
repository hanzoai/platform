# Hanzo Cloud Integration

This platform can operate in two modes:
1. **Standalone Mode**: Deploy applications to local Docker (open source)
2. **Hanzo Cloud Mode**: Deploy applications to Hanzo Cloud infrastructure (commercial)

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Hanzo Platform                        │
│                                                          │
│  ┌──────────────┐        ┌────────────────────────┐    │
│  │   Web UI     │───────▶│  Deployment Router     │    │
│  └──────────────┘        └─────────┬──────────────┘    │
│                                    │                     │
│                          ┌─────────▼──────────┐         │
│                          │  Target Selector   │         │
│                          └─────────┬──────────┘         │
│                                    │                     │
│            ┌───────────────────────┼──────────────────┐ │
│            │                       │                  │ │
│     ┌──────▼─────┐         ┌──────▼─────┐           │ │
│     │Local Docker│         │Hanzo Cloud │           │ │
│     │  Deployer  │         │   Client   │           │ │
│     └──────┬─────┘         └──────┬─────┘           │ │
│            │                       │                  │ │
└────────────┼───────────────────────┼──────────────────┘
             │                       │
      ┌──────▼─────┐          ┌─────▼──────────┐
      │   Docker   │          │  Hanzo Cloud   │
      │   Engine   │          │ Infrastructure │
      └────────────┘          └────────────────┘
```

## Configuration

### 1. Environment Variables

Configure the deployment's environment (Helm values, or KMS-sourced env on the App CR):

```bash
# Enable Hanzo Cloud integration
HANZO_CLOUD_ENABLED=true
IS_CLOUD=true

# API Configuration
HANZO_CLOUD_API_URL=https://api.hanzo.ai
HANZO_CLOUD_API_KEY=your-api-key

# Shared Authentication
HANZO_SHARED_AUTH=true
HANZO_CLIENT_ID=your-client-id
HANZO_CLIENT_SECRET=your-client-secret
```

### 2. Multi-Node Features (Commercial Only)

When `IS_CLOUD=true`, the following features are disabled in the open source version:
- Multi-server management (`/dashboard/settings/servers`)
- Cluster management (`/dashboard/settings/cluster`)
- Docker Swarm mode (`/dashboard/swarm`)
- Server-specific deployments

### 3. Deployment Targets

Users can choose between:
- **Local Docker**: Self-hosted, full control
- **Hanzo Cloud**: Managed, auto-scaling, global CDN

## Integration Points

### 1. Shared Authentication

The platform uses Better Auth, which can be configured to share authentication with the Hanzo Cloud console:

```typescript
// In lib/auth.ts
export const auth = betterAuth({
  database: db,
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    },
  },
  // Shared with Hanzo Cloud when HANZO_SHARED_AUTH=true
  trustedOrigins: process.env.HANZO_SHARED_AUTH === "true"
    ? ["https://console.hanzo.ai", "https://platform.hanzo.ai"]
    : [],
});
```

### 2. Project Templates

Pre-configured templates optimized for Hanzo Cloud:

```typescript
const templates = {
  nextjs: "Next.js Application",
  api: "API Service",
  python: "Python Application",
  static: "Static Site",
};
```

### 3. Deployment Workflow

```typescript
// Application deployment
await routeApplicationDeployment(application, {
  target: "cloud",  // or "local"
  region: "us-west-1",
  environment: "production",
  resources: {
    cpu: 1000,    // 1 CPU
    memory: 2048, // 2GB RAM
    disk: 10,     // 10GB disk
  },
});
```

## API Endpoints

### Deployment API

- `POST /v1/deploy/cloud` - Deploy to Hanzo Cloud
- `GET /v1/deployments/{id}` - Get deployment status
- `GET /v1/deployments/{id}/logs` - Stream deployment logs
- `DELETE /v1/deployments/{id}` - Cancel deployment

### Webhook Endpoints

- `/v1/webhooks/deployment-started`
- `/v1/webhooks/deployment-completed`
- `/v1/webhooks/deployment-failed`

## Features Comparison

| Feature | Local Docker | Hanzo Cloud |
|---------|--------------|-------------|
| Auto-scaling | ❌ | ✅ (1-10 replicas) |
| Global CDN | ❌ | ✅ (Cloudflare) |
| Automated Backups | ❌ | ✅ (Daily) |
| SSL Certificates | Manual | ✅ (Automatic) |
| DDoS Protection | ❌ | ✅ |
| Multi-region | ❌ | ✅ |
| Resource Limits | System | Configurable |
| Monitoring | Basic | ✅ (DataDog) |
| Cost | Infrastructure | Pay-per-use |

## Development Workflow

### Local Testing

1. Set `LOCAL_CLOUD_MODE=true` in `.env`
2. Set `MOCK_CLOUD_API=true` to use mock endpoints
3. Run `pnpm dev` to start the platform

### Production Deployment

1. Configure production environment variables
2. Build the platform: `pnpm build`
3. Deploy with Docker: `docker compose up -d`

## Security Considerations

1. **API Keys**: Store securely, rotate regularly
2. **Webhooks**: Validate signatures using `WEBHOOK_SECRET`
3. **Authentication**: Use strong `BETTER_AUTH_SECRET`
4. **Network**: Use VPN/private network for database access

## Migration from Standalone to Cloud

1. Export application configurations
2. Update environment variables
3. Restart the platform
4. Re-deploy applications to Hanzo Cloud

## Troubleshooting

### Common Issues

1. **Authentication fails**: Check `HANZO_CLIENT_ID` and `HANZO_CLIENT_SECRET`
2. **Deployments fail**: Verify `HANZO_CLOUD_API_KEY` is valid
3. **Region not available**: Check `AVAILABLE_REGIONS` configuration
4. **Multi-node blocked**: Ensure `IS_CLOUD=false` for self-hosted

### Debug Mode

Enable debug logging:
```bash
DEBUG=hanzo:* pnpm dev
```

## Support

- Documentation: https://docs.hanzo.ai/platform
- API Reference: https://api.hanzo.ai/docs
- Support: support@hanzo.ai