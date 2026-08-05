# Vendored: `trpc-openapi`

Third-party source, MIT, copied here verbatim. **Not our code — do not
refactor it to our style, and do not fix bugs here without also reporting
them upstream.**

| | |
|---|---|
| Upstream | https://github.com/dokploy/trpc-openapi |
| Replaces | `@dokploy/trpc-openapi@0.0.17` (the npm package) |
| Commit | see `.upstream-commit` (`ea210c4`, the `0.0.17` release) |
| License | MIT, Copyright 2024 Mario Campa — see `LICENSE` |

## Why it is vendored

It was a dependency on another product's npm scope. `@dokploy/*` is
upstream's private namespace: we do not control its publishing, its
release cadence, or whether a version disappears, and taking a runtime
dependency on a fork of ours announces itself in every install.

Upstream `trpc-openapi` (jlalmes) is not a migration path — it is
tRPC v10 only and unmaintained, while this repo is on tRPC v11. The
Dokploy fork exists precisely because it retargets v11 and moves schema
introspection onto `zod-openapi` for zod v4. So the choice was to own
the source or to keep the scope; we own the source.

## What was taken

The generator, the shared utils, the `fetch` adapter, and the
`node-http` core the fetch adapter is built on — 1505 lines.

The `express`, `fastify`, `koa`, `next`, `nuxt` and `standalone`
adapters were dropped: nothing here mounts them, and they are what
dragged in the `h3` dependency. Everything else is byte-identical to
upstream, so a future re-sync is a diff against `.upstream-commit`.

## How to reach it

Through `@hanzo/platform/openapi` — the one public entry point. Nothing
outside this directory should import `vendor/trpc-openapi/*` directly,
so that re-syncing or replacing the vendored tree stays a change to one
file.
