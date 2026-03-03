import { useRouter } from "next/router";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import type { GetServerSidePropsContext } from "next";

export const AcceptInvitation = () => {
	const { query } = useRouter();

	const invitationId = query["accept-invitation"];

	return (
		<div>
			<Button
				onClick={async () => {
					const result = await authClient.organization.acceptInvitation({
						invitationId: invitationId as string,
					});
					console.log(result);
				}}
			>
				Accept Invitation
			</Button>
		</div>
	);
};

// Force server-side rendering to avoid static generation
export async function getServerSideProps(ctx: GetServerSidePropsContext) {
	return { props: {} };
}

export default AcceptInvitation;
