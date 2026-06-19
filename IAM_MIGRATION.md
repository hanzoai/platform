# Platform → IAM-only auth (rip out Better Auth)

**Goal:** platform has NO auth of its own. All identity via `@hanzo/iam`
against the **gateway** `https://api.hanzo.ai` → `/v1/iam/*`. client_id
`hanzo-platform`. No email/password, no GitHub/Google, no Better Auth login.

**Why staged, not one deploy:** Dokploy is built on Better Auth. `validateRequest`
(`pkg/platform/src/lib/auth.ts:283`, ~30 callers) returns `{session, user}` where
`user` is a row in the `user`/`member`/`organization`/`apikey` tables, and every
`project`/`deployment`/`domain` FKs into them. So this is a data-model migration.

## Endpoint (decided)
`@hanzo/iam` config everywhere: `{ serverUrl: "https://api.hanzo.ai", clientId: "hanzo-platform" }`.
The SDK drives `/v1/iam/oauth/{authorize,token,userinfo,logout}` + `/v1/iam/.well-known/jwks`
through the gateway. The login redirect lands on `api.hanzo.ai/v1/iam/oauth/authorize`;
`redirect_uri` is `https://platform.hanzo.ai/<callback>`.

## Stage 1 — identity → IAM (deployable milestone)
Both halves ship together (keystone alone locks everyone out):

**a) Login flow (so a token exists).** Wrap the app in `IamProvider` (`@hanzo/iam/react`).
Replace the Better Auth login page with `useIam().signIn` (PKCE S256 redirect to
`api.hanzo.ai/v1/iam/oauth/authorize`). Add a callback route that exchanges the code for
a token and sets the `hanzo_iam_access_token` httpOnly cookie. Delete email/password +
GitHub/Google + the `betterAuth()` social/email config.

**b) Keystone — `validateRequest`.** Flip the session path to IAM, keep the
`{session, user}` shape the 30 callers expect:
```ts
import { getServerSession } from "@hanzo/iam/server";
const IAM = { serverUrl: "https://api.hanzo.ai", clientId: process.env.IAM_CLIENT_ID ?? "hanzo-platform" };

// (api-key path stays until Stage 3)
const s = await getServerSession(request, IAM); // reads Bearer / hanzo_iam_access_token cookie; verifies vs api.hanzo.ai/v1/iam jwks; fails closed on aud
if (!s) return { session: null, user: null };
const user = await upsertUserFromIam(s);          // by s.email / s.userId → local user row (keeps FK data model intact)
const member = await db.query.member.findFirst({ where: eq(schema.member.userId, user.id), with: { organization: true } });
return { session: { userId: user.id, activeOrganizationId: member?.organizationId ?? "" }, user };
```
`upsertUserFromIam`: find user by email (or IAM `sub`); create if absent (id = IAM sub or
generated; name/email from claims); ensure a `member` row in the org matching `s.owner`.

→ After Stage 1: IAM is the sole identity; platform validates IAM tokens; DB user/org
tables remain but are populated FROM IAM. Build a real semver, deploy, Playwright-verify
login on `platform.hanzo.ai`.

## Stage 2 — orgs → IAM
Map platform `organization` to the IAM (Casdoor) multi-tenant orgs (`s.owner`). Drop the
better-auth `organization` plugin; org membership derives from IAM claims.

## Stage 3 — API keys → IAM
Platform keys issued/validated against IAM (or KMS-backed); drop the better-auth `apiKey`
plugin and the api-key path in `validateRequest`.

## Stage 4 — delete the shell
Remove `betterAuth()` (`pkg/platform/src/lib/auth.ts`), `app/platform/lib/auth-client.ts`,
the `pages/api/v1/iam/[...all].ts` handler, and the better-auth tables (`account`,
`session`, `verification`, the better-auth columns on `user`). Better Auth gone.

## Foundations already in place (this session)
- `@hanzo/iam@0.11.0` published to npm (has `/server`, `/react`, `/browser`, `/betterauth`).
- Deterministic IAM client secrets: `universe/infra/k8s/iam/secret-sync` (HMAC-from-KMS),
  hanzo-platform redirect on `/v1/iam`, zoo-cloud/bootnode-platform apps — hanzoai/universe.
- Endpoint decided: `api.hanzo.ai` (gateway), `/v1/iam/*`.
- Release tags use real semver (`vX.Y.Z`), never `sha-*`/`:latest`.
