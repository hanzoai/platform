import Link from "next/link";
import type React from "react";
import { useWhitelabelingPublic } from "@/utils/hooks/use-whitelabeling";
import { GithubIcon } from "../icons/data-tools-icons";
import { Logo } from "../shared/logo";
import { Button } from "../ui/button";

interface Props {
	children: React.ReactNode;
}
export const OnboardingLayout = ({ children }: Props) => {
	const { config: whitelabeling } = useWhitelabelingPublic();
	const appName = whitelabeling?.appName || "Hanzo Platform";
	const customDescription = whitelabeling?.appDescription;
	const appDescription =
		customDescription ||
		"\u201CThe Open Source alternative to Amazon, Azure, and Google Cloud.\u201D";
	const logoUrl =
		whitelabeling?.loginLogoUrl || whitelabeling?.logoUrl || undefined;

	return (
		<div className="container relative min-h-svh flex-col items-center justify-center flex lg:max-w-none lg:grid lg:grid-cols-2 lg:px-0 w-full">
			<Link
				href="https://hanzo.ai"
				className="absolute top-6 left-6 z-30 flex items-center gap-3 text-lg font-medium text-primary lg:hidden"
			>
				<Logo className="size-8" />
				Hanzo
			</Link>
			<div className="relative hidden h-full flex-col  p-10 text-primary dark:border-r lg:flex">
				<div className="absolute inset-0 bg-muted" />
				<Link
					href="https://hanzo.ai"
					className="relative z-20 flex items-center text-lg font-medium gap-4  text-primary"
				>
					<Logo className="size-10" />
					Hanzo
				</Link>
				<div className="relative z-20 mt-auto">
					<blockquote className="space-y-2">
						<p className="text-lg text-primary">{appDescription}</p>
						{!customDescription && (
							<p className="text-sm text-muted-foreground">
								Open Source AI cloud powered by Proof of AI — that pays the OSS
								developers it runs on.
							</p>
						)}
					</blockquote>
				</div>
			</div>
			<div className="w-full">
				<div className="flex w-full flex-col justify-center space-y-6 max-w-lg mx-auto">
					{children}
				</div>
				<div className="flex items-center gap-4 justify-center absolute bottom-4 right-4 text-muted-foreground">
					<Button variant="ghost" size="icon">
						<Link href="https://github.com/hanzoai/platform">
							<GithubIcon />
						</Link>
					</Button>
				</div>
			</div>
		</div>
	);
};
