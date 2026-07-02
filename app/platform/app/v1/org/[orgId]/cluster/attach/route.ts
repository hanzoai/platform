/**
 * POST /v1/org/{orgId}/cluster/attach
 *
 * Attach an external (bring-your-own) Kubernetes cluster as a deploy target for
 * the org. Body: { name, kubeconfig }. The kubeconfig is validated, then sealed
 * (AES-256-GCM, services/secret-box) before it touches the DB — the ciphertext
 * is never returned. The attached cluster lands `phase=requested`; call
 * /v1/org/{orgId}/cluster/{clusterId}/install-baseline to make it deployable.
 *
 * Auth: shared service bearer token (PLATFORM_SERVICE_TOKEN | PAAS_SERVICE_TOKEN).
 */
import { apiAttachExternalCluster } from "@hanzo/platform/db/schema";
import { attachExternalCluster } from "@hanzo/platform/services/dedicated-cluster";
import { requireServiceToken } from "@/server/v1/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKENS = ["PLATFORM_SERVICE_TOKEN", "PAAS_SERVICE_TOKEN"] as const;

export async function POST(
	req: Request,
	ctx: { params: Promise<{ orgId: string }> },
) {
	const auth = requireServiceToken(req, TOKENS);
	if (!auth.ok) return auth.response;
	const { orgId } = await ctx.params;

	try {
		// Force the org from the path; validate name + kubeconfig from the body.
		const raw = await req.json().catch(() => ({}));
		const body = typeof raw === "object" && raw ? raw : {};
		const parsed = apiAttachExternalCluster.safeParse({
			...body,
			organizationId: orgId,
		});
		if (!parsed.success) {
			return Response.json(
				{ message: "Invalid request", issues: parsed.error.issues },
				{ status: 400 },
			);
		}
		const cluster = await attachExternalCluster(parsed.data);
		return Response.json({ cluster }, { status: 201 });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : "Attach cluster failed";
		return Response.json({ message }, { status: 500 });
	}
}
