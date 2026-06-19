import { type ReactElement, useEffect, useRef, useState } from "react";
import { OnboardingLayout } from "@/components/layouts/onboarding-layout";
import { Logo } from "@/components/shared/logo";
import { AlertBlock } from "@/components/shared/alert-block";
import { Button } from "@/components/ui/button";
import { CardDescription, CardTitle } from "@/components/ui/card";
import { createIam } from "@/lib/iam-browser";

/**
 * IAM OAuth2 callback. The @hanzo/iam PKCE flow lands here after the user
 * authenticates at hanzo.id. We exchange the code for tokens client-side, then
 * POST the access token to /v1/iam/session so the server pins it as the
 * httpOnly cookie validateRequest reads. Finally, a full-page nav to the
 * dashboard re-runs SSR with the cookie in place.
 */
export default function AuthCallback() {
	const ran = useRef(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (ran.current) return;
		ran.current = true;

		(async () => {
			try {
				const iam = createIam();
				const token = await iam.handleCallback(window.location.href);

				const res = await fetch("/v1/iam/session", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						accessToken: token.accessToken,
						expiresIn: token.expiresIn,
					}),
				});
				if (!res.ok) {
					throw new Error(`session sync failed (${res.status})`);
				}

				// Full-page navigation so getServerSideProps sees the new cookie.
				window.location.replace("/dashboard/home");
			} catch (err) {
				setError(
					err instanceof Error ? err.message : "Sign-in could not be completed",
				);
			}
		})();
	}, []);

	return (
		<>
			<div className="flex flex-col space-y-2 text-center">
				<h1 className="text-2xl font-semibold tracking-tight">
					<div className="flex flex-row items-center justify-center gap-2">
						<Logo className="size-12" />
						<CardTitle>Signing you in…</CardTitle>
					</div>
				</h1>
				<CardDescription>Completing sign-in with Hanzo</CardDescription>
			</div>
			{error && (
				<div className="mt-4">
					<AlertBlock type="error" className="my-2">
						<span>{error}</span>
					</AlertBlock>
					<Button
						className="mt-2 w-full"
						onClick={() => window.location.replace("/")}
					>
						Back to sign in
					</Button>
				</div>
			)}
		</>
	);
}

AuthCallback.getLayout = (page: ReactElement) => {
	return <OnboardingLayout>{page}</OnboardingLayout>;
};
