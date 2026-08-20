import { buildArgsProblem } from "@hanzo/platform/services/ci";
import { repoProblem } from "@hanzo/platform/services/hanzo-git";

/**
 * Build-enqueue request rules — the pure half of POST /v1/runner.
 *
 * These are decisions about a build request, not about HTTP. They live here
 * rather than in the route because a Next.js App Router `route.ts` may export
 * ONLY the request handlers and its route config (`runtime`, `dynamic`, …);
 * Next's generated `.next/types` constrains every other export to `never`, so
 * exporting a helper from the route is a type error and the tests that import
 * these rules cannot reach them. Route = transport, this = policy.
 *
 * What a destination may be — the registry, the namespace, and the name it
 * publishes under — is `services/org`, asked by `enqueueDirectBuild` on the way
 * through, so this door and the delivery lane get one answer from one rule.
 */

export { buildArgsProblem, repoProblem };
