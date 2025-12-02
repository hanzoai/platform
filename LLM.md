# Hanzo Platform - LLM Context Document

## Project Overview

Hanzo Platform is a self-hosted cloud deployment platform (similar to Netlify, Vercel, Heroku) with support for:
- Docker container deployments
- Database management (PostgreSQL, MySQL, MariaDB, MongoDB, Redis)
- Docker Compose deployments
- Application deployments with various builders (Nixpacks, Docker, etc.)
- Multi-organization support with role-based access control

## Architecture

### Directory Structure
```
/home/z/platform/
├── app/
│   └── platform/           # Next.js frontend application
│       ├── components/     # React components
│       ├── pages/          # Next.js pages
│       ├── server/         # TRPC API routers
│       └── drizzle/        # Database migrations
├── pkg/
│   └── platform/           # Shared TypeScript library
│       ├── src/
│       │   ├── db/schema/  # Drizzle ORM schemas
│       │   └── services/   # Backend services
└── docker-compose.yml      # Development setup
```

### Tech Stack
- **Frontend**: Next.js 15, React, TailwindCSS, shadcn/ui
- **API**: TRPC with superjson serialization
- **Database**: PostgreSQL with Drizzle ORM
- **Auth**: better-auth library
- **Container Orchestration**: Docker / Docker Swarm
- **Reverse Proxy**: Traefik

### Key Database Tables
Located in `pkg/platform/src/db/schema/`:
- `account.ts` - Organizations, users, members, sessions
- `application.ts` - Deployed applications
- `compose.ts` - Docker Compose deployments
- `billing.ts` - Prepaid credit billing system (NEW)

## Billing System (Implemented 2025-12-02)

### Overview
Prepaid credit billing system supporting crypto and wire transfer payments. No auto-billing (Stripe not usable), manual credit top-up only.

### Database Schema (`pkg/platform/src/db/schema/billing.ts`)

#### Tables:
1. **organization_billing** - Credit balance and billing settings per organization
   - `creditBalance` - Balance in USD cents
   - `lowBalanceThreshold` - Alert threshold (default $100)
   - `preferredPaymentMethod` - crypto/wire

2. **credit_transaction** - Transaction history
   - Types: credit_purchase, wire_transfer, crypto_payment, usage_deduction, admin_adjustment, refund
   - Statuses: pending, completed, failed, cancelled
   - Tracks amount, balance after, external references

3. **usage_record** - Usage tracking for compute/AI
   - Types: compute, ai_credits, storage, bandwidth, api_calls
   - Links to resources (applications, compose deployments)
   - Tracks quantity, unit price, total cost

4. **invoice** - Monthly billing summaries
   - Statuses: draft, pending, paid, overdue, cancelled
   - Line items breakdown

5. **payment_instructions** - Crypto addresses and wire details for Hanzo
   - Seeded with sample ETH, BTC, USDC addresses and wire details

### API Routes (`app/platform/server/api/routers/billing.ts`)

#### User Routes:
- `getOrganizationBilling` - Get/create billing record
- `updateBillingSettings` - Update billing contact info
- `getPaymentInstructions` - Get active payment methods
- `getCreditBalance` - Get current balance
- `getTransactions` - Transaction history
- `getUsageRecords` - Usage breakdown
- `getInvoices` - Invoice list

#### Admin Routes:
- `addCredits` - Manual credit top-up
- `deductCredits` - Usage deductions
- `createInvoice` - Generate invoices
- `updateInvoiceStatus` - Mark invoices paid
- `recordUsage` - Log usage records
- `getAllOrganizationsBilling` - Admin dashboard
- `createPaymentInstruction` - Manage payment methods
- `updatePaymentInstruction` - Edit payment methods
- `deletePaymentInstruction` - Remove payment methods

### UI Components

1. **Billing Page** (`components/dashboard/settings/billing/show-billing.tsx`)
   - Credit balance display
   - Payment instructions (crypto/wire tabs)
   - Transaction history table
   - Usage records table
   - Invoices table

2. **Admin Billing** (`components/dashboard/settings/billing/admin-billing.tsx`)
   - Organization list with balances
   - Add credits dialog
   - Search/filter organizations

### Pages
- `/dashboard/settings/billing` - User billing page
- `/dashboard/settings/admin-billing` - Admin billing management

### Sidebar Navigation
Both pages added to sidebar in `components/layouts/side.tsx`:
- Billing - visible to all authenticated users
- Admin Billing - visible to admin/owner only

## Database Connections

### Production
- Container: `hanzo-postgres`
- User: `hanzo`
- Password: `amukds4wi9001583845717ad2`
- Database: `hanzo`

### Development
- Container: `hanzo-postgres-dev`
- User: `hanzo`
- Password: `devpass2025secure`
- Database: `hanzo`

## Deployment Notes

### Docker Network
Uses `hanzo-network` overlay network for container communication.

### Traefik Configuration
- Dynamic configs in `/etc/traefik/dynamic/`
- Platform routing: `platform.yml`
- Dev routing: `platform-dev.yml`

### Building
```bash
cd /home/z/platform/app/platform
npm run build
```

### Running Migrations
```bash
# Generate migration
cd /home/z/platform/app/platform
npx drizzle-kit generate

# Apply to dev
cat drizzle/XXXX_migration_name.sql | docker exec -i hanzo-postgres-dev psql -U hanzo -d hanzo

# Apply to production
cat drizzle/XXXX_migration_name.sql | docker exec -i hanzo-postgres psql -U hanzo -d hanzo
```

## Key Organizations
- **RAV** (zqWLxUR9t25J3YPVzXXVw) - Americas Voice News
  - zen-live-app-kbveog compose deployment

## Recent Changes (2025-12-02)
1. Added prepaid credit billing system
2. Created billing schema with 5 tables
3. Implemented TRPC billing router
4. Created user billing page with crypto/wire payment instructions
5. Created admin billing management interface
6. Added sidebar navigation for billing pages
7. Migration: `0114_fine_human_torch.sql`
