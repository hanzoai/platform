import { loadStripe } from "@stripe/stripe-js";
import {
	CheckIcon,
	CreditCard,
	Loader2,
	Sparkles,
	Zap,
	Building2,
	Crown,
	Server,
	Cpu,
	Mic,
	Image,
	Star,
	Brain,
	Palette,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

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

const PRICING_API =
	process.env.NEXT_PUBLIC_PRICING_API_URL || "https://pricing.hanzo.ai";

const planIcons: Record<string, typeof Sparkles> = {
	developer: Sparkles,
	pro: Zap,
	team: Building2,
	enterprise: Crown,
};

interface CloudPlan {
	id: string;
	name: string;
	description: string;
	vcpus: number;
	memoryGB: number;
	diskGB: number;
	cpuType: string;
	maxVMs: number;
	priceMonthly: number;
	priceHourly: number;
	freeTier?: boolean;
	popular?: boolean;
	features: string[];
}

interface PricingData {
	cloudPlans: CloudPlan[];
	models: any[];
	tools: any[];
	gpu: any[];
	blockStorage: {
		pricePerGBMonthly: number;
		minSizeGB: number;
		maxSizeGB: number;
	} | null;
	loading: boolean;
}

function usePricingData(): PricingData {
	const [data, setData] = useState<PricingData>({
		cloudPlans: [],
		models: [],
		tools: [],
		gpu: [],
		blockStorage: null,
		loading: true,
	});

	useEffect(() => {
		Promise.all([
			fetch(`${PRICING_API}/v1/pricing/cloud/plans`)
				.then((r) => r.json())
				.catch(() => null),
			fetch(`${PRICING_API}/v1/pricing`)
				.then((r) => r.json())
				.catch(() => null),
		])
			.then(([cloudData, fullData]) => {
				setData({
					cloudPlans: cloudData?.plans ?? [],
					models: fullData?.hanzoModels ?? [],
					tools: Array.isArray(fullData?.tools) ? fullData.tools : [],
					gpu: fullData?.infrastructure?.gpu ?? [],
					blockStorage: fullData?.cloud?.blockStorage ?? null,
					loading: false,
				});
			})
			.catch(() => {
				setData((prev) => ({ ...prev, loading: false }));
			});
	}, []);

	return data;
}

/** Format a price number with a unit string for tool pricing display. */
function formatToolPrice(price: number, unit: string): string {
	if (price >= 1) return `$${price}/${unit}`;
	if (price >= 0.01) return `$${price.toFixed(2)}/${unit}`;
	return `$${price}/${unit}`;
}

export const ShowBilling = () => {
	const { data: wallet } = api.billing.getWallet.useQuery();
	const { data: balance } = api.billing.getBalance.useQuery();
	const { data: plans, isLoading } = api.billing.getPlans.useQuery();
	const { mutateAsync: createSubscription, isPending: isSubscribing } =
		api.billing.createSubscription.useMutation();
	const { mutateAsync: createPortalSession } =
		api.billing.createPortalSession.useMutation();

	const [isAnnual, setIsAnnual] = useState(false);
	const [activeTab, setActiveTab] = useState<
		"subscription" | "cloud" | "ai"
	>("subscription");
	const pricing = usePricingData();

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

	// Group models by category from API data
	const chatModels = pricing.models.filter(
		(m: any) =>
			m.name?.startsWith("zen4") &&
			!m.name?.includes("coder") &&
			!m.pricingUnit,
	);
	const codeModels = pricing.models.filter(
		(m: any) => m.name?.includes("coder") && !m.pricingUnit,
	);
	const multimodalModels = pricing.models.filter(
		(m: any) =>
			m.name?.startsWith("zen3") &&
			!m.name?.includes("embed") &&
			!m.name?.includes("rerank") &&
			!m.pricingUnit,
	);
	const embeddingModels = pricing.models.filter(
		(m: any) => m.name?.includes("embed") || m.name?.includes("rerank"),
	);
	const audioModels = pricing.models.filter(
		(m: any) => m.pricingUnit === "minute",
	);
	const imageModels = pricing.models.filter(
		(m: any) => m.pricingUnit === "image" || m.pricingUnit === "step",
	);

	return (
		<div className="w-full">
			<Card className="h-full bg-sidebar p-2.5 rounded-xl max-w-6xl mx-auto">
				<div className="rounded-xl bg-background shadow-md">
					<CardHeader>
						<CardTitle className="text-xl flex flex-row gap-2">
							<CreditCard className="size-6 text-muted-foreground self-center" />
							Billing & Pricing
						</CardTitle>
						<CardDescription>
							Platform subscriptions, cloud compute, and AI model
							pricing
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-6 py-8 border-t">
						{/* Current Balance */}
						{wallet && (
							<div className="flex flex-col gap-2 p-4 rounded-lg border bg-muted/30">
								<div className="flex items-center justify-between">
									<span className="text-sm font-medium">
										Current Balance
									</span>
									<span className="text-lg font-bold">
										$
										{(balance?.balance ?? 0).toFixed(2)}
									</span>
								</div>
								<div className="flex items-center justify-between text-sm text-muted-foreground">
									<span>Current Plan</span>
									<Badge
										variant="secondary"
										className="capitalize"
									>
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

						{/* Section Tabs */}
						<Tabs
							value={activeTab}
							onValueChange={(v) =>
								setActiveTab(v as typeof activeTab)
							}
							className="w-full"
						>
							<TabsList className="w-full grid grid-cols-3">
								<TabsTrigger
									value="subscription"
									className="gap-1.5"
								>
									<Sparkles className="size-3.5" /> Plans
								</TabsTrigger>
								<TabsTrigger
									value="cloud"
									className="gap-1.5"
								>
									<Server className="size-3.5" /> Cloud
								</TabsTrigger>
								<TabsTrigger value="ai" className="gap-1.5">
									<Brain className="size-3.5" /> AI Models
								</TabsTrigger>
							</TabsList>
						</Tabs>

						{/* ═══════════════ Subscription Plans ═══════════════ */}
						{activeTab === "subscription" && (
							<div className="space-y-6">
								<Tabs
									value={isAnnual ? "annual" : "monthly"}
									onValueChange={(e) =>
										setIsAnnual(e === "annual")
									}
								>
									<TabsList>
										<TabsTrigger value="monthly">
											Monthly
										</TabsTrigger>
										<TabsTrigger value="annual">
											Annual{" "}
											<Badge
												variant="outline"
												className="ml-1.5 text-xs"
											>
												Save 20%
											</Badge>
										</TabsTrigger>
									</TabsList>
								</Tabs>

								{isLoading ? (
									<div className="flex items-center justify-center min-h-[10vh]">
										<Loader2 className="animate-spin" />
									</div>
								) : (
									<div className="grid gap-4 md:grid-cols-2">
										{planOrder.map((planKey) => {
											const plan = plans?.[planKey];
											if (!plan) return null;
											const Icon =
												planIcons[planKey] || Sparkles;
											const isCurrent =
												currentPlan === planKey;
											const isEnterprise =
												planKey === "enterprise";
											const isPro = planKey === "pro";
											const monthlyPrice =
												isAnnual &&
												plan.annualFee != null
													? plan.annualFee / 12
													: plan.monthlyFee;

											return (
												<div
													key={planKey}
													className={cn(
														"flex flex-col rounded-xl border p-5 transition-all",
														isPro
															? "border-primary shadow-md ring-1 ring-primary/20"
															: "border-border",
														isCurrent &&
															"bg-muted/20",
													)}
												>
													<div className="flex items-center gap-2 mb-3">
														<Icon className="size-5 text-primary" />
														<h3 className="font-semibold text-lg">
															{plan.name}
														</h3>
														{isPro && (
															<Badge className="ml-auto">
																Popular
															</Badge>
														)}
														{isCurrent && (
															<Badge
																variant="outline"
																className="ml-auto"
															>
																Current
															</Badge>
														)}
													</div>
													<div className="mb-4">
														{isEnterprise ? (
															<p className="text-2xl font-bold">
																Custom
															</p>
														) : (
															<>
																<span className="text-3xl font-bold">
																	$
																	{monthlyPrice.toFixed(
																		0,
																	)}
																</span>
																<span className="text-sm text-muted-foreground">
																	/mo
																</span>
															</>
														)}
													</div>
													<div className="text-sm text-muted-foreground mb-4">
														{planKey ===
															"developer" &&
															"Free tier with $5 credit"}
														{planKey === "pro" &&
															"For developers shipping products"}
														{planKey === "team" &&
															"SSO, shared billing, custom training"}
														{planKey ===
															"enterprise" &&
															"Custom SLA & dedicated support"}
													</div>
													{isEnterprise ? (
														<Button
															variant="outline"
															className="w-full mt-auto"
															asChild
														>
															<Link href="mailto:sales@hanzo.ai">
																Contact Sales
															</Link>
														</Button>
													) : isCurrent ? (
														<Button
															variant="outline"
															className="w-full mt-auto"
															onClick={
																handleManageSubscription
															}
														>
															Manage Plan
														</Button>
													) : (
														<Button
															className={cn(
																"w-full mt-auto",
																isPro &&
																	"bg-primary",
															)}
															variant={
																isPro
																	? "default"
																	: "outline"
															}
															disabled={
																isSubscribing
															}
															onClick={() =>
																handleSubscribe(
																	planKey,
																)
															}
														>
															{isSubscribing && (
																<Loader2 className="animate-spin mr-2 size-4" />
															)}
															{plan.monthlyFee ===
															0
																? "Get Started Free"
																: `Upgrade to ${plan.name}`}
														</Button>
													)}
												</div>
											);
										})}
									</div>
								)}

								{/* Included with all plans */}
								<div className="p-4 rounded-lg border bg-muted/20">
									<h4 className="text-sm font-semibold mb-3">
										Included with All Plans
									</h4>
									<div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm text-muted-foreground">
										<div className="flex items-center gap-1.5">
											<CheckIcon className="size-3.5 text-primary" />{" "}
											Zero egress fees
										</div>
										<div className="flex items-center gap-1.5">
											<CheckIcon className="size-3.5 text-primary" />{" "}
											DDoS protection
										</div>
										<div className="flex items-center gap-1.5">
											<CheckIcon className="size-3.5 text-primary" />{" "}
											Automated backups
										</div>
										<div className="flex items-center gap-1.5">
											<CheckIcon className="size-3.5 text-primary" />{" "}
											100+ AI models
										</div>
									</div>
								</div>
							</div>
						)}

						{/* ═══════════════ Cloud VM Plans ═══════════════ */}
						{activeTab === "cloud" && (
							<div className="space-y-6">
								<p className="text-sm text-muted-foreground">
									Cloud VM plans for deploying services. Same
									pricing across all regions.
								</p>

								{pricing.loading ? (
									<div className="flex items-center justify-center min-h-[10vh]">
										<Loader2 className="animate-spin" />
									</div>
								) : pricing.cloudPlans.length === 0 ? (
									<div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
										Unable to load cloud plans. Please try
										again later.
									</div>
								) : (
									<>
										<div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
											{pricing.cloudPlans.map((plan) => (
												<div
													key={plan.id}
													className={cn(
														"rounded-xl border p-4 bg-card transition-colors relative",
														plan.popular
															? "border-primary ring-1 ring-primary/20"
															: "hover:border-primary/30",
													)}
												>
													{plan.popular && (
														<div className="absolute -top-2.5 left-3 px-2 py-0.5 bg-primary text-primary-foreground text-xs font-medium rounded-full flex items-center gap-1">
															<Star className="size-3" />{" "}
															Most Popular
														</div>
													)}
													<div className="flex items-baseline justify-between mb-2">
														<h3 className="font-semibold">
															{plan.name}
														</h3>
														<div>
															<span className="text-xl font-bold">
																$
																{
																	plan.priceMonthly
																}
															</span>
															<span className="text-xs text-muted-foreground">
																/mo
															</span>
														</div>
													</div>
													<div className="space-y-1 text-xs text-muted-foreground">
														<div>
															{plan.vcpus} vCPU (
															{plan.cpuType})
															&middot;{" "}
															{plan.memoryGB} GB
															RAM
														</div>
														<div>
															{plan.diskGB} GB
															SSD &middot; Up
															to {plan.maxVMs} VM
															{plan.maxVMs > 1
																? "s"
																: ""}
														</div>
													</div>
													{plan.freeTier && (
														<div className="mt-1.5 text-xs text-green-500 font-medium">
															$5 free credit
														</div>
													)}
												</div>
											))}
										</div>

										{/* GPU Tiers — from pricing API */}
										{pricing.gpu.length > 0 && (
											<div className="space-y-3">
												<h4 className="text-sm font-semibold flex items-center gap-1.5">
													<Cpu className="size-4" />{" "}
													GPU Compute
												</h4>
												<div className="grid gap-3 md:grid-cols-3">
													{pricing.gpu.map(
														(tier: any) => (
															<div
																key={tier.name}
																className="rounded-lg border p-3 bg-card"
															>
																<div className="font-medium text-sm">
																	{tier.name}
																</div>
																<div className="text-xs text-muted-foreground mt-1">
																	{tier.gpu}{" "}
																	&middot;{" "}
																	{tier.vram}
																</div>
																<div className="text-sm font-bold mt-1.5">
																	$
																	{tier.price}
																	/hr
																</div>
															</div>
														),
													)}
												</div>
												<p className="text-xs text-muted-foreground">
													72% cheaper than AWS. No
													commitment required.
												</p>
											</div>
										)}

										{/* Storage & Extras — from pricing API */}
										<div className="p-4 rounded-lg border bg-muted/20">
											<h4 className="text-sm font-semibold mb-3">
												Additional Services
											</h4>
											<div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
												<div className="text-center p-2 rounded bg-background border">
													<div className="font-bold">
														$
														{pricing.blockStorage
															?.pricePerGBMonthly ??
															"—"}
													</div>
													<div className="text-xs text-muted-foreground">
														/GB storage/mo
													</div>
												</div>
												<div className="text-center p-2 rounded bg-background border">
													<div className="font-bold">
														$0
													</div>
													<div className="text-xs text-muted-foreground">
														egress fees
													</div>
												</div>
												<div className="text-center p-2 rounded bg-background border">
													<div className="font-bold">
														Included
													</div>
													<div className="text-xs text-muted-foreground">
														DDoS protection
													</div>
												</div>
												<div className="text-center p-2 rounded bg-background border">
													<div className="font-bold">
														Included
													</div>
													<div className="text-xs text-muted-foreground">
														automated backups
													</div>
												</div>
											</div>
										</div>
									</>
								)}
							</div>
						)}

						{/* ═══════════════ AI Model Pricing ═══════════════ */}
						{activeTab === "ai" && (
							<div className="space-y-6">
								<p className="text-sm text-muted-foreground">
									All models available through the Hanzo AI
									Gateway. Zero markup on third-party models.
								</p>

								{pricing.loading ? (
									<div className="flex items-center justify-center min-h-[10vh]">
										<Loader2 className="animate-spin" />
									</div>
								) : pricing.models.length === 0 ? (
									<div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
										Unable to load model pricing. Please try
										again later.
									</div>
								) : (
									<>
										{/* Zen4 Chat Models */}
										{chatModels.length > 0 && (
											<ModelSection
												title="Zen4 Chat & Reasoning"
												icon={
													<Brain className="size-4" />
												}
												models={chatModels}
											/>
										)}

										{/* Code Models */}
										{codeModels.length > 0 && (
											<ModelSection
												title="Zen4 Coder"
												icon={
													<Cpu className="size-4" />
												}
												models={codeModels}
											/>
										)}

										{/* Multimodal Models */}
										{multimodalModels.length > 0 && (
											<ModelSection
												title="Zen3 Multimodal"
												icon={
													<Image className="size-4" />
												}
												models={multimodalModels}
											/>
										)}

										{/* Embeddings */}
										{embeddingModels.length > 0 && (
											<ModelSection
												title="Embeddings & Reranking"
												icon={
													<Sparkles className="size-4" />
												}
												models={embeddingModels}
											/>
										)}

										{/* Image Generation — from pricing API */}
										{imageModels.length > 0 && (
											<div className="space-y-3">
												<h4 className="text-sm font-semibold flex items-center gap-1.5">
													<Palette className="size-4" />{" "}
													Image Generation
												</h4>
												<div className="rounded-lg border overflow-hidden">
													<table className="w-full text-sm">
														<thead>
															<tr className="border-b bg-muted/30">
																<th className="px-3 py-2 text-left font-medium">
																	Model
																</th>
																<th className="px-3 py-2 text-right font-medium">
																	Price
																</th>
																<th className="px-3 py-2 text-right font-medium">
																	Tier
																</th>
															</tr>
														</thead>
														<tbody>
															{imageModels.map(
																(m: any) => (
																	<tr
																		key={
																			m.name
																		}
																		className="border-b last:border-0"
																	>
																		<td className="px-3 py-2">
																			<div className="font-medium">
																				{m.fullName ||
																					m.name}
																			</div>
																			{m.description && (
																				<div className="text-xs text-muted-foreground line-clamp-1">
																					{
																						m.description
																					}
																				</div>
																			)}
																		</td>
																		<td className="px-3 py-2 text-right font-mono">
																			$
																			{
																				m
																					.pricing
																					?.perUnit
																			}
																			/
																			{
																				m.pricingUnit
																			}
																		</td>
																		<td className="px-3 py-2 text-right">
																			<Badge
																				variant="outline"
																				className="text-xs capitalize"
																			>
																				{m.tier ||
																					"—"}
																			</Badge>
																		</td>
																	</tr>
																),
															)}
														</tbody>
													</table>
												</div>
											</div>
										)}

										{/* Audio & Speech — from pricing API */}
										{audioModels.length > 0 && (
											<div className="space-y-3">
												<h4 className="text-sm font-semibold flex items-center gap-1.5">
													<Mic className="size-4" />{" "}
													Audio & Speech
												</h4>
												<div className="rounded-lg border overflow-hidden">
													<table className="w-full text-sm">
														<thead>
															<tr className="border-b bg-muted/30">
																<th className="px-3 py-2 text-left font-medium">
																	Model
																</th>
																<th className="px-3 py-2 text-right font-medium">
																	Price/min
																</th>
																<th className="px-3 py-2 text-right font-medium">
																	Tier
																</th>
															</tr>
														</thead>
														<tbody>
															{audioModels.map(
																(m: any) => (
																	<tr
																		key={
																			m.name
																		}
																		className="border-b last:border-0"
																	>
																		<td className="px-3 py-2">
																			<div className="font-medium">
																				{m.fullName ||
																					m.name}
																			</div>
																			{m.description && (
																				<div className="text-xs text-muted-foreground line-clamp-1">
																					{
																						m.description
																					}
																				</div>
																			)}
																		</td>
																		<td className="px-3 py-2 text-right font-mono">
																			$
																			{
																				m
																					.pricing
																					?.perUnit
																			}
																		</td>
																		<td className="px-3 py-2 text-right">
																			<Badge
																				variant="outline"
																				className="text-xs capitalize"
																			>
																				{m.tier ||
																					"—"}
																			</Badge>
																		</td>
																	</tr>
																),
															)}
														</tbody>
													</table>
												</div>
											</div>
										)}

										{/* Tool Pricing — from pricing API */}
										{pricing.tools.length > 0 && (
											<div className="space-y-3">
												<h4 className="text-sm font-semibold">
													Tool Pricing
												</h4>
												<div className="grid grid-cols-2 md:grid-cols-3 gap-3">
													{pricing.tools.map(
														(tool: any) => (
															<div
																key={tool.name}
																className="rounded-lg border p-3 bg-card"
															>
																<div className="text-xs text-muted-foreground">
																	{tool.name}
																</div>
																<div className="text-sm font-bold mt-0.5">
																	{formatToolPrice(
																		tool.price,
																		tool.unit,
																	)}
																</div>
															</div>
														),
													)}
												</div>
											</div>
										)}

										{/* Third-party */}
										<div className="p-4 rounded-lg border bg-muted/20">
											<h4 className="text-sm font-semibold mb-2">
												100+ Third-Party Models
											</h4>
											<p className="text-xs text-muted-foreground">
												GPT-5, Claude Opus 4.6, Gemini
												3.1 Pro, DeepSeek R1, Llama 4,
												Mistral Large, and more — all at
												provider pricing with{" "}
												<span className="font-medium text-foreground">
													zero markup
												</span>
												. Same API key, same endpoint.
											</p>
										</div>
									</>
								)}
							</div>
						)}

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

/** Renders a table of models with their specs and pricing tier. */
function ModelSection({
	title,
	icon,
	models,
}: {
	title: string;
	icon: React.ReactNode;
	models: any[];
}) {
	return (
		<div className="space-y-3">
			<h4 className="text-sm font-semibold flex items-center gap-1.5">
				{icon} {title}
			</h4>
			<div className="rounded-lg border overflow-hidden">
				<table className="w-full text-sm">
					<thead>
						<tr className="border-b bg-muted/30">
							<th className="px-3 py-2 text-left font-medium">
								Model
							</th>
							<th className="px-3 py-2 text-left font-medium hidden md:table-cell">
								Architecture
							</th>
							<th className="px-3 py-2 text-right font-medium hidden md:table-cell">
								Context
							</th>
							<th className="px-3 py-2 text-right font-medium">
								Tier
							</th>
						</tr>
					</thead>
					<tbody>
						{models.map((m: any) => (
							<tr
								key={m.name}
								className="border-b last:border-0"
							>
								<td className="px-3 py-2">
									<div className="font-medium">
										{m.fullName || m.name}
									</div>
									{m.description && (
										<div className="text-xs text-muted-foreground line-clamp-1">
											{m.description}
										</div>
									)}
								</td>
								<td className="px-3 py-2 text-xs text-muted-foreground hidden md:table-cell">
									{m.specs?.arch || "—"}
									{m.specs?.params && (
										<div className="text-xs">
											{m.specs.params}
										</div>
									)}
								</td>
								<td className="px-3 py-2 text-right text-xs text-muted-foreground hidden md:table-cell">
									{m.context
										? `${(m.context / 1000).toFixed(0)}K`
										: "—"}
								</td>
								<td className="px-3 py-2 text-right">
									<Badge
										variant="outline"
										className="text-xs capitalize"
									>
										{m.tier || "—"}
									</Badge>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}
