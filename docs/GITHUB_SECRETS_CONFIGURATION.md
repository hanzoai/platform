# GitHub Secrets Configuration for Hanzo Cloud CI/CD

This document outlines all required GitHub secrets for automated CI/CD deployments across the Hanzo ecosystem.

## Common Secrets (All Repositories)

These secrets need to be configured in each repository that deploys to Hanzo Cloud:

| Secret | Description | Example |
|--------|-------------|---------|
| `DEPLOY_HOST` | Production server IP address | `143.198.188.26` |
| `DEPLOY_USER` | SSH username for deployment | `root` |
| `DEPLOY_SSH_KEY` | SSH private key (Ed25519 or RSA) | `-----BEGIN OPENSSH PRIVATE KEY-----...` |
| `DEPLOY_PORT` | SSH port (optional, defaults to 22) | `22` |
| `STAGING_HOST` | Staging server IP (for canary deploys) | `143.198.188.26` |
| `SLACK_WEBHOOK` | Slack webhook URL for notifications | `https://hooks.slack.com/services/...` |

## Repository-Specific Secrets

### Platform (`hanzoai/platform`)

| Secret | Description | Required |
|--------|-------------|----------|
| `DOCKERHUB_USERNAME` | Docker Hub username | Yes |
| `DOCKERHUB_TOKEN` | Docker Hub access token | Yes |
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `REDIS_URL` | Redis connection string | Yes |
| `AUTH_SECRET` | NextAuth secret key | Yes |
| `NEXTAUTH_URL` | Public URL of Platform | Yes |
| `SERVER_URL` | Internal server URL | Yes |
| `SERVER_IP` | Server IP for Docker access | Yes |
| `GITHUB_CLIENT_ID` | GitHub OAuth client ID | Yes |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth client secret | Yes |
| `DO_API_TOKEN` | DigitalOcean API token (for elastic scaling) | Optional |
| `STRIPE_SECRET_KEY` | Stripe secret key (for billing) | Optional |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret | Optional |
| `NEXT_PUBLIC_ANALYTICS_HOST` | Analytics host URL | Optional |
| `NEXT_PUBLIC_ANALYTICS_WEBSITE_ID` | Analytics website ID | Optional |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key | Optional |

### IAM (`hanzoai/iam`)

| Secret | Description | Required |
|--------|-------------|----------|
| `GITHUB_TOKEN` | Auto-provided for GHCR pushes | Yes (auto) |

### Console (`hanzoai/console`)

| Secret | Description | Required |
|--------|-------------|----------|
| `DOCKERHUB_USERNAME` | Docker Hub username | Yes |
| `DOCKERHUB_TOKEN` | Docker Hub access token | Yes |

## Setting Up SSH Key for Deployment

1. Generate a new SSH key pair:
   ```bash
   ssh-keygen -t ed25519 -C "github-actions-deploy" -f deploy_key -N ""
   ```

2. Add public key to the server:
   ```bash
   ssh root@143.198.188.26 "cat >> ~/.ssh/authorized_keys" < deploy_key.pub
   ```

3. Add private key as `DEPLOY_SSH_KEY` secret in GitHub:
   - Go to Repository → Settings → Secrets and variables → Actions
   - Click "New repository secret"
   - Name: `DEPLOY_SSH_KEY`
   - Value: Contents of `deploy_key` file

## Setting Up Docker Hub Access

1. Create Docker Hub access token:
   - Go to Docker Hub → Account Settings → Security → Access Tokens
   - Click "New Access Token"
   - Description: "GitHub Actions - hanzoai"
   - Permissions: Read & Write

2. Add secrets:
   - `DOCKERHUB_USERNAME`: Your Docker Hub username
   - `DOCKERHUB_TOKEN`: The generated access token

## Setting Up Slack Notifications

1. Create Slack incoming webhook:
   - Go to https://api.slack.com/apps
   - Create new app or use existing
   - Add "Incoming Webhooks" feature
   - Create webhook for your deployment channel

2. Add `SLACK_WEBHOOK` secret with the webhook URL

## Environment Deployments

Configure GitHub Environments for deployment protection:

### Production Environment
- Name: `production`
- Protection rules:
  - Require reviewers (optional)
  - Wait timer: 0 minutes (optional delay)
  - Branch protection: `main` only

### Staging Environment
- Name: `staging`
- Protection rules:
  - Branch protection: `canary` only

## Workflow Files Overview

| Repository | Workflow | Trigger | Deploy Target |
|------------|----------|---------|---------------|
| Platform | `docker-deploy.yml` | Push to main | Production |
| Platform | `docker-deploy.yml` | Push to canary | Staging |
| IAM | `docker-deploy.yml` | Push to main/master | Production |
| Console | `docker-deploy.yml` | Push to main | Production |
| Console | `docker-deploy.yml` | Workflow dispatch | Production/Staging |

## Server Requirements

The deployment server (143.198.188.26) must have:

1. **Docker & Docker Compose**:
   ```bash
   docker --version  # >= 24.x
   docker compose version  # >= 2.x
   ```

2. **Compose file at `/root/hanzo/compose.production.yml`**

3. **Network `hanzo-network`**:
   ```bash
   docker network create hanzo-network
   ```

4. **Required directories**:
   ```bash
   /root/hanzo/
   ├── compose.production.yml
   ├── compose.staging.yml
   └── .env.production
   ```

## Verification Commands

After configuring secrets, verify deployment with:

```bash
# Trigger manual deployment
gh workflow run docker-deploy.yml --repo hanzoai/platform

# Check workflow status
gh run list --repo hanzoai/platform --workflow docker-deploy.yml

# View deployment logs
gh run view <run-id> --repo hanzoai/platform --log
```

## Troubleshooting

### SSH Connection Failed
- Verify `DEPLOY_SSH_KEY` is complete (including headers)
- Check authorized_keys on server
- Ensure firewall allows SSH from GitHub Actions IPs

### Docker Push Failed
- Verify Docker Hub credentials
- Check repository access permissions
- Ensure rate limits aren't exceeded

### Health Check Failed
- Check container logs: `docker logs hanzo-<service> --tail 100`
- Verify network connectivity
- Check environment variables in compose file
