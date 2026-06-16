# paas — AI Assistant Context

## Authentication: one way (HIP-0111)

PaaS auth goes through `@hanzo/iam` against the canonical OIDC endpoints — server-side `validateToken`/`getServerSession` from `@hanzo/iam/server`, better-auth via `iamProvider()` from `@hanzo/iam/betterauth` (explicit endpoints, NEVER `genericOAuth({discoveryUrl})`). Brand origin via `serverUrl` (`IAM_ENDPOINT`, default `https://iam.hanzo.ai`); endpoints are `/v1/iam/oauth/*`. No legacy paths, no hand-rolled OAuth. Spec: HIP-0111 (auth) + HIP-0112 (cloud topology).

<div align="center">
  <a href="https://hanzo.ai">
    <img src=".github/sponsors/logo.png" alt="Hanzo - Open Source Alternative to Vercel, Heroku and Netlify." width="100%"  />
  </a>
  </br>
