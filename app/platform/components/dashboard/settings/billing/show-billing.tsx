import { loadStripe } from "@stripe/stripe-js";
import {
	CheckIcon,
	CreditCard,
	Loader2,
	Sparkles,
	Zap,
	Building2,
	Crown,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

const stripePromise = loadStripe(
	process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!,
);
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { api } from "@/utils/api";
import type { PlanType } from "@hanzo/platform/billing/pricing";

const planIcons: Record<string, typeof Sparkles> = {
	developer: Sparkles,
	pro: Zap,
	team: Building2,
	enterprise: Crown,
};

const planFeatures: Record<string, string[]> = {
	developer: [
		"Up to 4 GB RAM per service",
		"Up to 4 vCPU per service",
		"50 GB storage",
		"$5/mo in compute credits",
		"1 organization",
		"Community support",
	],
	pro: [
		"Up to 16 GB RAM per service",
		"Up to 16 vCPU per service",
		"250 GB storage",
		"$49/mo in compute credits",
		"Up to 3 organizations",
		"Priority support",
	],
	team: [
		"Up to 32 GB RAM per service",
		"Up to 32 vCPU per service",
		"500 GB storage",
		"$199/mo in compute credits",
		"Unlimited organizations",
		"Dedicated support",
	],
	enterprise: [
		"Unlimited RAM per service",
		"Unlimited vCPU per service",
		"Unlimited storage",
		"Custom compute credits",
		"Unlimited organizations",
		"Custom SLA & support",
	],
};

export const ShowBilling = () => {
	const { data: wallet } = api.billing.getWallet.useQuery();
	const { data: balance } = api.billing.getBalance.useQuery();
	const { data: plans, isLoading } = api.billing.getPlans.useQuery();
	const { mutateAsync: createSubscription, isPending: isSubscribing } =
		api.billing.createSubscription.useMutation();
	const { mutateAsync: createPortalSession } =
		api.billing.createPortalSession.useMutation();

	const [isAnnual, setIsAnnual] = useState(false);

	const handleSubscribe = async (plan: PlanType) => {
		const stripe = await stripePromise;
		const result = await createSubscription({ plan });
		if (result?.sessionId && stripe) {
			await stripe.redirectToCheckout({ sessionId: result.sessionId });
		}
	};

	const handleManageSubscription = async () => {
		const session = await createPortalSession();
		if (session?.url) {
			window.open(session.url);
		}
	};

	const currentPlan = wallet?.plan || "developer";
	const planOrder: PlanType[] = ["developer", "pro", "team", "enterprise"];

	return (
		<div className="w-full">
			<Card className="h-full bg-sidebar p-2.5 rounded-xl max-w-5xl mx-auto">
				<div className="rounded-xl bg-background shadow-md">
					<CardHeader>
						<CardTitle className="text-xl flex flex-row gap-2">
							<CreditCard className="size-6 text-muted-foreground self-center" />
							Billing
						</CardTitle>
						<CardDescription>
							Manage your subscription and compute credits
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-6 py-8 border-t">
						{/* Current Balance */}
						{wallet && (
							<div className="flex flex-col gap-2 p-4 rounded-lg border bg-muted/30">
								<div className="flex items-center justify-between">
									<span className="text-sm font-medium">Current Balance</span>
									<span className="text-lg font-bold">
										${(balance?.balance ?? 0).toFixed(2)}
									</span>
								</div>
								<div className="flex items-center justify-between text-sm text-muted-foreground">
									<span>Current Plan</span>
									<Badge variant="secondary" className="capitalize">
										{currentPlan}
									</Badge>
								</div>
								<Button
									variant="secondary"
									size="sm"
									className="w-fit mt-2"
									onClick={handleManageSubscription}
								>
									Manage Subscription
								</Button>
							</div>
						)}

						{/* Billing Period Toggle */}
						<Tabs
							defaultValue="monthly"
							value={isAnnual ? "annual" : "monthly"}
							className="w-full"
							onValueChange={(e) => setIsAnnual(e === "annual")}
						>
							<TabsList>
								<TabsTrigger value="monthly">Monthly</TabsTrigger>
								<TabsTrigger value="annual">
									Annual{" "}
									<Badge variant="outline" className="ml-1.5 text-xs">
										Save 20%
									</Badge>
								</TabsTrigger>
							</TabsList>
						</Tabs>

						{/* Plans */}
						{isLoading ? (
							<span className="text-base text-muted-foreground flex flex-row gap-3 items-center justify-center min-h-[10vh]">
								Loading plans...
								<Loader2 className="animate-spin" />
							</span>
						) : (
							<div className="grid gap-4 md:grid-cols-2">
								{planOrder.map((planKey) => {
									const plan = plans?.[planKey];
									if (!plan) return null;
									const Icon = planIcons[planKey] || Sparkles;
									const features = planFeatures[planKey] || [];
									const isCurrent = currentPlan === planKey;
									const isEnterprise = planKey === "enterprise";
									const isPro = planKey === "pro";
									const monthlyPrice = isAnnual && plan.annualFee != null
										? plan.annualFee / 12
										: plan.monthlyFee;
									const totalPrice = isAnnual && plan.annualFee != null
										? plan.annualFee
										: plan.monthlyFee;

									return (
										<div
											key={planKey}
											className={cn(
												"flex flex-col rounded-xl border p-5 transition-all",
												isPro
													? "border-primary shadow-md ring-1 ring-primary/20"
													: "border-border",
												isCurrent && "bg-muted/20",
											)}
										>
											<div className="flex items-center gap-2 mb-3">
												<Icon className="size-5 text-primary" />
												<h3 className="font-semibold text-lg">
													{plan.name}
												</h3>
												{isPro && (
													<Badge className="ml-auto">Popular</Badge>
												)}
												{isCurrent && (
													<Badge variant="outline" className="ml-auto">
														Current
													</Badge>
												)}
											</div>

											<div className="mb-4">
												{isEnterprise ? (
													<p className="text-2xl font-bold">Custom</p>
												) : (
													<>
														<span className="text-3xl font-bold">
															${monthlyPrice.toFixed(0)}
														</span>
														<span className="text-sm text-muted-foreground">
															/mo
														</span>
														{isAnnual && plan.annualFee != null && (
															<p className="text-xs text-muted-foreground mt-1">
																${totalPrice.toFixed(0)}/yr billed annually
															</p>
														)}
													</>
												)}
											</div>

											<ul className="flex flex-col gap-2 mb-6 flex-1">
												{features.map((feature) => (
													<li
														key={feature}
														className="flex items-start gap-2 text-sm text-muted-foreground"
													>
														<CheckIcon className="size-4 text-primary shrink-0 mt-0.5" />
														{feature}
													</li>
												))}
											</ul>

											{isEnterprise ? (
												<Button variant="outline" className="w-full" asChild>
													<Link href="mailto:sales@hanzo.ai">
														Contact Sales
													</Link>
												</Button>
											) : isCurrent ? (
												<Button
													variant="outline"
													className="w-full"
													onClick={handleManageSubscription}
												>
													Manage Plan
												</Button>
											) : (
												<Button
													className={cn(
														"w-full",
														isPro && "bg-primary text-primary-foreground",
													)}
													variant={isPro ? "default" : "outline"}
													disabled={isSubscribing}
													onClick={() => handleSubscribe(planKey)}
												>
													{isSubscribing ? (
														<Loader2 className="animate-spin mr-2 size-4" />
													) : null}
													{plan.monthlyFee === 0
														? "Get Started Free"
														: `Upgrade to ${plan.name}`}
												</Button>
											)}
										</div>
									);
								})}
							</div>
						)}

						{/* Usage Rates */}
						<div className="mt-6 p-4 rounded-lg border bg-muted/20">
							<h4 className="text-sm font-semibold mb-3">
								Usage-Based Compute Pricing
							</h4>
							<p className="text-xs text-muted-foreground mb-3">
								Credits are consumed based on actual resource usage. All plans
								include monthly credits applied automatically.
							</p>
							<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
								<div className="text-center p-2 rounded bg-background border">
									<div className="text-sm font-bold">$10</div>
									<div className="text-xs text-muted-foreground">
										/GB RAM/mo
									</div>
								</div>
								<div className="text-center p-2 rounded bg-background border">
									<div className="text-sm font-bold">$20</div>
									<div className="text-xs text-muted-foreground">
										/vCPU/mo
									</div>
								</div>
								<div className="text-center p-2 rounded bg-background border">
									<div className="text-sm font-bold">$0.15</div>
									<div className="text-xs text-muted-foreground">
										/GB storage/mo
									</div>
								</div>
								<div className="text-center p-2 rounded bg-background border">
									<div className="text-sm font-bold">$0.05</div>
									<div className="text-xs text-muted-foreground">/GB egress</div>
								</div>
							</div>
						</div>

						{/* Help */}
						<div className="flex flex-col gap-1.5 mt-4">
							<span className="text-base text-primary">
								Need Help? We are here to help you.
							</span>
							<span className="text-sm text-muted-foreground">
								Join our Discord server and we will help you.
							</span>
							<Button className="rounded-full bg-[#5965F2] hover:bg-[#4A55E0] w-fit">
								<Link
									href="https://discord.gg/2tBnJ3jDJc"
									target="_blank"
									className="flex flex-row items-center gap-2 text-white"
								>
									<svg
										role="img"
										className="h-6 w-6 fill-white"
										viewBox="0 0 24 24"
										xmlns="http://www.w3.org/2000/svg"
									>
										<path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
									</svg>
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
