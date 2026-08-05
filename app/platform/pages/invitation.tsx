import { getUserByToken } from "@hanzo/platform";
import { validateRequest } from "@hanzo/platform/lib/auth";
import type { GetServerSidePropsContext } from "next";
import Link from "next/link";
import { useRouter } from "next/router";
import { type ReactElement, useState } from "react";
import { toast } from "sonner";
import { OnboardingLayout } from "@/components/layouts/onboarding-layout";
import { AlertBlock } from "@/components/shared/alert-block";
import { Logo } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import { CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";
import { startSignIn } from "@/lib/iam-browser";

interface Props {
	token: string;
	email: string | null;
	/** Whether the visitor already has a platform session. */
	isSignedIn: boolean;
}

/**
 * Accept an organization invitation.
 *
 * Identity is Hanzo IAM (HIP-0111), so this page never creates an account and
 * never asks for a password — it only accepts. A signed-out visitor is handed
 * to IAM and comes straight back here (the callback honours the parked return
 * path), at which point accepting is one click.
 *
 * It used to render a full name/email/password registration form calling
 * `authClient.signUp.email`. The server configures no `emailAndPassword`
 * provider, so that form could only ever fail — and had it worked, it would
 * have been the platform minting its own credentials.
 */
const Invitation = ({ token, email, isSignedIn }: Props) => {
	const router = useRouter();
	const [isWorking, setIsWorking] = useState(false);

	const accept = async () => {
		setIsWorking(true);
		try {
			const { error } = await authClient.organization.acceptInvitation({
				invitationId: token,
			});
			if (error) {
				toast.error(error.message ?? "Could not accept the invitation");
				setIsWorking(false);
				return;
			}
			toast.success("Invitation accepted");
			router.push("/dashboard/projects");
		} catch {
			toast.error("Could not accept the invitation");
			setIsWorking(false);
		}
	};

	const signIn = async () => {
		setIsWorking(true);
		try {
			// Come back to this invitation once IAM has authenticated the user.
			await startSignIn(`/invitation?token=${encodeURIComponent(token)}`);
		} catch (err) {
			setIsWorking(false);
			toast.error(
				err instanceof Error ? err.message : "Could not start sign-in",
			);
		}
	};

	return (
		<div className="flex h-screen w-full items-center justify-center">
			<div className="flex w-full flex-col items-center gap-4">
				<CardTitle className="flex items-center gap-2 text-2xl font-bold">
					<Link
						href="https://hanzo.ai"
						target="_blank"
						className="flex flex-row items-center gap-2"
					>
						<Logo className="size-12" />
					</Link>
					Invitation
				</CardTitle>

				<AlertBlock type="success">
					<div className="flex flex-col gap-2">
						<span className="font-medium">You have been invited</span>
						{email && (
							<span className="text-sm text-green-600 dark:text-green-400">
								This invitation is for {email}.
							</span>
						)}
					</div>
				</AlertBlock>

				<CardDescription className="text-center">
					{isSignedIn
						? "Accept to join the organization."
						: "Sign in with Hanzo to accept this invitation."}
				</CardDescription>

				<CardContent className="w-full p-0">
					<Button
						className="w-full"
						isLoading={isWorking}
						onClick={() => void (isSignedIn ? accept() : signIn())}
					>
						{isSignedIn ? "Accept invitation" : "Sign in with Hanzo"}
					</Button>
				</CardContent>
			</div>
		</div>
	);
};

export default Invitation;

Invitation.getLayout = (page: ReactElement) => {
	return <OnboardingLayout>{page}</OnboardingLayout>;
};

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
	const token = ctx.query.token;

	if (typeof token !== "string") {
		return { redirect: { permanent: true, destination: "/" } };
	}

	try {
		const invitation = await getUserByToken(token);

		if (invitation.isExpired) {
			return { redirect: { permanent: true, destination: "/" } };
		}

		let isSignedIn = false;
		try {
			const { user } = await validateRequest(ctx.req);
			isSignedIn = !!user;
		} catch {
			isSignedIn = false;
		}

		return {
			props: {
				token,
				email: invitation.email ?? null,
				isSignedIn,
			},
		};
	} catch {
		return { redirect: { permanent: true, destination: "/" } };
	}
}
