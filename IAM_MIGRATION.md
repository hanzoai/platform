## ✅ CANONICAL — the one login way (settled 2026-06-20, do not re-litigate)

Platform login is **Hanzo IAM via PKCE. No Better Auth login, no `genericOAuth`, no `signIn.social`/`signIn.oauth2`.** Stage 1 is SHIPPED in source. End-to-end flow:

1. `pages/index.tsx` auto-redirects via `createIam().signinRedirect()` (PKCE S256).
2. IAM authenticates at **`https://hanzo.id`**, redirects to `/auth/callback`.
3. `pages/auth/callback.tsx` → `handleCallback()` exchanges the code, POSTs the token to `pages/api/v1/iam/session.ts`, which sets the **`hanzo_iam_access_token` httpOnly cookie**.
4. Full-page nav to `/dashboard/home`; `getServerSideProps` → `validateRequest` → `getServerSession(req, IAM)` verifies the cookie vs `hanzo.id` JWKS → `upsertUserFromIam` resolves the local `user`/`member` row.

**Endpoint = `https://hanzo.id`** (NOT `api.hanzo.ai`, NOT iam.hanzo.ai, NOT a per-app path). Deliberate: the console's proven prod path, CORS-enabled for browser OIDC, so no `proxyBaseUrl`. Config: `app/platform/lib/iam-browser.ts` + `pkg/platform/src/lib/iam.ts`. `client_id = hanzo-platform`.

**`sign-in-with-hanzo.tsx` (genericOAuth button) was DELETED 2026-06-20** — dead (imported nowhere) and the sole thing that made the model look contradictory. Better Auth survives only as the host for api-key / organization / sso plugins (Stages 2–4).

### Where it actually stands (2026-08) — read this before claiming a stage is done

| Stage | State |
|---|---|
| 1 — identity → IAM | **DONE.** `validateRequest` verifies the IAM token against hanzo.id's JWKS (issuer + audience pinned, fails closed) and resolves it onto the local user row. |
| 2 — orgs → IAM | **DONE.** `lib/iam-org.ts#syncIamOrgMembership` derives the org/membership graph from the IAM claims. This is also the first-run bootstrap: the first identity to sign in gets its home org and an `owner` membership. |
| — login UI | **DONE (2026-08).** The fork's own auth screens are deleted — registration, password reset, GitHub/Google sign-in, social account linking. The server configures no `emailAndPassword`/`emailVerification`/`socialProviders`, so they were calling endpoints that do not exist, and `pages/index.tsx` was routing self-hosted first-run traffic into one of them. `pages/invitation.tsx` now only accepts an invitation; it never creates an account. |
| 3 — API keys → IAM | **NOT STARTED.** `validateRequest`'s `x-api-key` branch still calls Better Auth's `api.verifyApiKey`, and the `apikey` table is still Better Auth's. |
| 4 — delete the shell | **NOT STARTED.** `betterAuth()` still runs. |

**Better Auth is still here.** It hosts four plugins — `apiKey`, `organization`
(invitations + `acceptInvitation`), `sso`, `admin` (impersonation) — and owns
the `account`, `session`, `verification` and `apikey` tables. What is gone is
its *login* surface: there is no second way to authenticate a human. Do not
describe the platform as "off Better Auth" until Stages 3 and 4 land.

Known gaps, stated rather than hidden:
- the `sso` plugin is itself a "SSO of our own" under the AUTH rule. Its only UI
  (`components/enterprise/sso/sign-in-with-sso.tsx`) is imported by nothing, but
  the server surface and the `sso` table remain. Stage 3/4 work.
- 2FA UI (`enable-2fa` / `configure-2fa`) is still rendered while the server's
  `twoFactor()` plugin is commented out, so it is dead the same way the
  password screens were. Removing it is safe and untaken.

**If `platform.hanzo.ai` login breaks, suspect a STALE deployed image first, not the auth code.** Deployed: `ghcr.io/hanzoai/platform:vX.Y.Z`; bump in `universe/infra/k8s/paas/kustomization.yaml`.

**Build (Node 24):** builds on `node:24.4.0`. Native deps (`ssh2`/`node-pty`) use `nan`; `nan` < 2.23 fails to compile on Node 24's V8 (`FunctionCallbackInfo has no member named 'Holder'`). Fixed by pnpm override **`nan: 2.27.0`** + `ssh2@1.17.0`. Do NOT remove the override while on Node 24.

---

# Platform → IAM-only auth (rip out Better Auth)

**Goal:** platform has NO auth of its own. All identity via `@hanzo/iam`
against the **gateway** `https://hanzo.id` → `/v1/iam/*`. client_id
`hanzo-platform`. No email/password, no GitHub/Google, no Better Auth login.

**Why staged, not one deploy:** the upstream fork this app derives from is built on Better Auth. `validateRequest`
(`pkg/platform/src/lib/auth.ts:283`, ~30 callers) returns `{session, user}` where
`user` is a row in the `user`/`member`/`organization`/`apikey` tables, and every
`project`/`deployment`/`domain` FKs into them. So this is a data-model migration.

## Endpoint (decided)
`@hanzo/iam` config everywhere: `{ serverUrl: "https://hanzo.id", clientId: "hanzo-platform" }`.
The SDK drives `/v1/iam/oauth/{authorize,token,userinfo,logout}` + `/v1/iam/.well-known/jwks`
through the gateway. The login redirect lands on `hanzo.id/v1/iam/oauth/authorize`;
`redirect_uri` is `https://platform.hanzo.ai/<callback>`.

## Stage 1 — identity → IAM (deployable milestone)
Both halves ship together (keystone alone locks everyone out):

**a) Login flow (so a token exists).** Wrap the app in `IamProvider` (`@hanzo/iam/react`).
Replace the Better Auth login page with `useIam().signIn` (PKCE S256 redirect to
`hanzo.id/v1/iam/oauth/authorize`). Add a callback route that exchanges the code for
a token and sets the `hanzo_iam_access_token` httpOnly cookie. Delete email/password +
GitHub/Google + the `betterAuth()` social/email config.

**b) Keystone — `validateRequest`.** Flip the session path to IAM, keep the
`{session, user}` shape the 30 callers expect:
```ts
import { getServerSession } from "@hanzo/iam/server";
const IAM = { serverUrl: "https://hanzo.id", clientId: process.env.IAM_CLIENT_ID ?? "hanzo-platform" };

// (api-key path stays until Stage 3)
const s = await getServerSession(request, IAM); // reads Bearer / hanzo_iam_access_token cookie; verifies vs hanzo.id/v1/iam jwks; fails closed on aud
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
Map platform `organization` to the IAM multi-tenant orgs (`s.owner`). Drop the
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
- Endpoint decided: `hanzo.id` (gateway), `/v1/iam/*`.
- Release tags use real semver (`vX.Y.Z`), never `sha-*`/`:latest`.
