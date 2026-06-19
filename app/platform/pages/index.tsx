import {
	getWebServerSettings,
	IS_CLOUD,
	isAdminPresent,
} from "@hanzo/platform";
import { validateRequest } from "@hanzo/platform/lib/auth";
import type { GetServerSidePropsContext } from "next";
import { type ReactElement, useEffect, useState } from "react";
import { OnboardingLayout } from "@/components/layouts/onboarding-layout";
import { AlertBlock } from "@/components/shared/alert-block";
import { Logo } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import { CardContent, CardDescription } from "@/components/ui/card";
import { createIam } from "@/lib/iam-browser";
import { useWhitelabelingPublic } from "@/utils/hooks/use-whitelabeling";

/**
 * Platform sign-in. The platform has NO auth of its own (HIP-0111): this page
 * only hands the user to Hanzo IAM via the @hanzo/iam PKCE redirect. No
 * email/password, no GitHub/Google, no Better Auth login UI.
 */
export default function Home() {
	const { config: whitelabeling } = useWhitelabelingPublic();
	const [error, setError] = useState<string | null>(null);
	const [isRedirecting, setIsRedirecting] = useState(false);

	const signIn = async () => {
		setError(null);
		setIsRedirecting(true);
		try {
			await createIam().signinRedirect();
		} catch (err) {
			setIsRedirecting(false);
			setError(
				err instanceof Error ? err.message : "Could not start sign-in with Hanzo",
			);
		}
	};

	// Kick the redirect off automatically — IAM is the only way in.
	useEffect(() => {
		void signIn();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return (
		<>
			<div className="flex flex-col space-y-2 text-center">
				<h1 className="text-2xl font-semibold tracking-tight">
					<div className="flex flex-row items-center justify-center gap-2">
						<Logo
							className="size-12"
							logoUrl={
								whitelabeling?.loginLogoUrl ||
								whitelabeling?.logoUrl ||
								undefined
							}
						/>
						Sign in
					</div>
				</h1>
				<p className="text-sm text-muted-foreground">
					Continue to Hanzo to sign in
				</p>
			</div>
			{error && (
				<AlertBlock type="error" className="my-2">
					<span>{error}</span>
				</AlertBlock>
			)}
			<CardContent className="p-0">
				<Button
					className="w-full"
					isLoading={isRedirecting}
					onClick={() => void signIn()}
				>
					Sign in with Hanzo
				</Button>
				<CardDescription className="mt-4 text-center">
					You'll be redirected to Hanzo to authenticate securely.
				</CardDescription>
			</CardContent>
		</>
	);
}

Home.getLayout = (page: ReactElement) => {
	return <OnboardingLayout>{page}</OnboardingLayout>;
};

export async function getServerSideProps(context: GetServerSidePropsContext) {
	if (IS_CLOUD) {
		try {
			const { user } = await validateRequest(context.req);
			if (user) {
				return {
					redirect: {
						permanent: false,
						destination: "/dashboard/home",
					},
				};
			}
		} catch {}

		return { props: {} };
	}

	// Self-hosted first-run still needs an initial admin before IAM is wired.
	const hasAdmin = await isAdminPresent();
	if (!hasAdmin) {
		return {
			redirect: {
				permanent: false,
				destination: "/register",
			},
		};
	}

	const { user } = await validateRequest(context.req);
	if (user) {
		return {
			redirect: {
				permanent: false,
				destination: "/dashboard/home",
			},
		};
	}

	await getWebServerSettings();
	return { props: {} };
}
