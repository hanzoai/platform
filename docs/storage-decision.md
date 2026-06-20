# Storage Decision

One canonical answer per role. This page is the platform-local pointer; the
binding decision lives in the org-wide architecture record:

**Canonical:** [`hanzoai/.github` → `profile/ARCHITECTURE-DATABASES.md`](https://github.com/hanzoai/.github/blob/main/profile/ARCHITECTURE-DATABASES.md)

That record supersedes any per-repo storage choice. The summary below is for
operators working inside this repo; when in doubt, the canonical record wins.

## Internal Hanzo apps → Base (per-tenant SQLite)

Every Hanzo app stores in [Base](https://github.com/hanzoai/base), one SQLite
file per `(org, user, project)`. The IAM OIDC `owner` claim selects the file —
the file *is* the tenant boundary, so there is no tenant column. DEK is
KMS-derived per file; the file is S3-replicated. There is no other internal
store. If an internal app reaches for Postgres, that is a bug to fix, not a
pattern to follow.

Local reference checkout: `~/work/hanzo/base`.

## Customer apps → PaaS catalog (products, not infra)

Postgres, Redis/KV, DocDB, MongoDB-compat, MariaDB, MySQL, and pgvector are
**billable products** provisioned by customers, for customer workloads,
through the PaaS catalog ("Customer Databases & Caches" in the dashboard).
They are not Hanzo-internal dependencies. The catalog entry point is
`app/platform/components/dashboard/project/add-database.tsx`.

The shared `hanzo-sql` cluster Postgres is being decommissioned; the
operator's Postgres CRD stays — that is how customers provision their own
Postgres through the catalog. We delete the shared instance, not the
capability.

## pgvector for RAG → catalog service, dogfooded

Retrieval-augmented generation uses pgvector provisioned **through the same
PaaS catalog path a customer would use**. Hanzo's own `rag-api` dogfoods this:
it provisions its own pgvector via PaaS rather than baking a vector store into
Base. rag-api is the reference customer of its own product, which proves the
catalog path works under first-party load.
