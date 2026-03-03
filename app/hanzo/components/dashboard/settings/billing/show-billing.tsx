import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/utils/api";
import { loadStripe } from "@stripe/stripe-js";
import { AlertTriangle, CreditCard, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

const stripePromise = loadStripe(
	process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!,
);

export const ShowBilling = () => {
	const { data: servers } = api.server.count.useQuery();
	const { data: admin } = api.user.get.useQuery();
	const { data, isLoading } = api.stripe.getProducts.useQuery();
	const { mutateAsync: createCheckoutSession } =
		api.stripe.createCheckoutSession.useMutation();
	const { mutateAsync: createCustomerPortalSession } =
		api.stripe.createCustomerPortalSession.useMutation();

	const [aiCredits, setAiCredits] = useState(10);
	const [additionalBases, setAdditionalBases] = useState(0);
	const [additionalApps, setAdditionalApps] = useState(0);

	const handleCheckout = async (productId: string) => {
		const stripe = await stripePromise;
		createCheckoutSession({
			productId,
			aiCredits,
			additionalBases,
			additionalApps,
		}).then(async (session) => {
			await stripe?.redirectToCheckout({ sessionId: session.sessionId });
		});
	};

	const maxServers = admin?.user.serversQuantity ?? 1;
	const percentage = ((servers ?? 0) / maxServers) * 100;
	const safePercentage = Math.min(percentage, 100);

	return (
		<div className="w-full">
			<Card className="h-full bg-sidebar p-2.5 rounded-xl max-w-full mx-auto">
				<div className="rounded-xl bg-background shadow-md">
					<CardHeader>
						<CardTitle className="text-xl flex flex-row gap-2">
							<CreditCard className="size-6 text-muted-foreground self-center" />
							Billing
						</CardTitle>
						<CardDescription>
							Manage your subscription and AI credits
						</CardDescription>
					</CardHeader>
					<CardContent className="py-8 border-t">
						{isLoading ? (
							<span className="flex gap-3 items-center justify-center min-h-[10vh]">
								Loading...
								<Loader2 className="animate-spin" />
							</span>
						) : (
							data?.products.map((product) => (
								<section
									key={product.id}
									className="border-dashed border-2 p-6 rounded-lg mb-6"
								>
									<h3 className="font-semibold text-lg">{product.name}</h3>
									<p className="text-muted-foreground">{product.description}</p>
									<p className="text-xl font-bold mt-2">
										${(product.default_price.unit_amount / 100).toFixed(2)} / mo
									</p>

									<div className="my-4">
										<span>
											AI Credits (${aiCredits}): ${aiCredits}
										</span>
										<Slider
											min={1}
											max={500}
											step={1}
											value={[aiCredits]}
											onValueChange={(val) => setAiCredits(val[0])}
										/>
									</div>

									<div className="my-4">
										<span>
											Additional Bases (${additionalBases}): $
											{(additionalBases * 5).toFixed(2)}
										</span>
										<Slider
											min={0}
											max={10}
											step={1}
											value={[additionalBases]}
											onValueChange={(val) => setAdditionalBases(val[0])}
										/>
									</div>

									<div className="my-4">
										<span>
											Additional Apps (${additionalApps}): $
											{(additionalApps * 5).toFixed(2)}
										</span>
										<Slider
											min={0}
											max={100}
											step={1}
											value={[additionalApps]}
											onValueChange={(val) => setAdditionalApps(val[0])}
										/>
									</div>

									<Button
										className="mt-4 w-full"
										onClick={() => handleCheckout(product.id)}
									>
										Subscribe
									</Button>
								</section>
							))
						)}

						{admin?.user.stripeSubscriptionId && (
							<div className="mt-6">
								<Progress value={safePercentage} />
								{servers && servers >= maxServers && (
									<div className="flex gap-2 items-center bg-yellow-100 p-2 rounded">
										<AlertTriangle className="text-yellow-600" />
										<span className="text-sm text-yellow-600">
											Max servers reached. Upgrade your plan to add more.
										</span>
									</div>
								)}
							</div>
						)}

						<div className="mt-8 text-center">
							<span className="text-primary">Need Help?</span>
							<Button className="bg-[#5965F2] hover:bg-[#4A55E0] mt-2">
								<Link href="https://discord.gg/XthHQQj" target="_blank">
									Join Discord
								</Link>
							</Button>
						</div>
					</CardContent>
				</div>
			</Card>
		</div>
	);
};
