export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GitHub App webhook stub — every delivery (including ping) just bounces the
// operator back to the git-providers settings page. Kept for parity with the
// App manifest's configured webhook URL.
export async function POST(req: Request) {
	return Response.redirect(
		new URL("/dashboard/settings/git-providers", req.url),
		307,
	);
}
