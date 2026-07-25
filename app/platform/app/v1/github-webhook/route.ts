/**
 * POST /v1/github-webhook — legacy alias of POST /v1/git-webhook.
 *
 * Zero logic, by design. The canonical front door for every git forge is
 * `/v1/git-webhook`; this path survives only because the Hanzo GitHub App's
 * configured delivery URL points at it, and rewiring a live App is not worth
 * the outage window. It re-exports the one handler — it never re-implements
 * it — so there is exactly ONE webhook code path, at two URLs.
 *
 * `runtime`/`dynamic` are declared here rather than re-exported: Next reads
 * route segment config by static analysis of the segment's own module.
 *
 * Retire this file once the App's webhook URL is repointed at /v1/git-webhook.
 */
export { POST } from "../git-webhook/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
