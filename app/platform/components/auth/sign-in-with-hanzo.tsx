import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function SignInWithHanzo() {
	const [isLoading, setIsLoading] = useState(false);

	return (
		<Button
			variant="default"
			className="w-full mb-2"
			isLoading={isLoading}
			onClick={async () => {
				setIsLoading(true);
				try {
					await authClient.signIn.social({ provider: "hanzo" });
				} catch {
					setIsLoading(false);
				}
			}}
		>
			<svg className="mr-2 h-4 w-4" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
				<text x="4" y="26" fontFamily="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif" fontSize="28" fontWeight="700" fill="currentColor">H</text>
			</svg>
			Sign in with Hanzo
		</Button>
	);
}
