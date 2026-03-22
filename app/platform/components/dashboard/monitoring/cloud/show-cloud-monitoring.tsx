import {
	Activity,
	Coins,
	ExternalLink,
	Loader2,
	MessageSquare,
	Zap,
} from "lucide-react";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { api } from "@/utils/api";

const O11Y_URL = "https://o11y.hanzo.ai";
const CONSOLE_URL = "https://console.hanzo.ai";

function formatNumber(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return n.toLocaleString();
}

function formatCost(n: number): string {
	return `$${n.toFixed(2)}`;
}

export const CloudMonitoring = () => {
	const { data: metrics, isPending, error } = api.server.getConsoleMetrics.useQuery(
		undefined,
		{ refetchInterval: 60_000 },
	);

	return (
		<div className="space-y-6">
			<header className="flex items-center justify-between">
				<div className="space-y-1">
					<h1 className="text-2xl font-semibold tracking-tight">
						Observability
					</h1>
					<p className="text-sm text-muted-foreground">
						LLM usage, traces, and cost from Hanzo Console
					</p>
				</div>
				<div className="flex gap-2">
					<Button
						variant="outline"
						size="sm"
						onClick={() => window.open(CONSOLE_URL, "_blank")}
					>
						<MessageSquare className="mr-2 h-4 w-4" />
						Open Console
						<ExternalLink className="ml-2 h-3 w-3" />
					</Button>
					<Button
						variant="outline"
						size="sm"
						onClick={() => window.open(O11Y_URL, "_blank")}
					>
						<Activity className="mr-2 h-4 w-4" />
						Open O11Y Dashboard
						<ExternalLink className="ml-2 h-3 w-3" />
					</Button>
				</div>
			</header>

			{isPending ? (
				<div className="flex h-[300px] w-full items-center justify-center">
					<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
				</div>
			) : error || !metrics ? (
				<Card>
					<CardContent className="flex flex-col items-center justify-center py-16 text-center">
						<Activity className="h-12 w-12 text-muted-foreground mb-4" />
						<p className="text-lg font-medium text-muted-foreground mb-2">
							{error ? "Failed to load metrics" : "Console not configured"}
						</p>
						<p className="text-sm text-muted-foreground max-w-md mb-6">
							{error
								? "Could not reach console.hanzo.ai. Check CONSOLE_PUBLIC_KEY and CONSOLE_SECRET_KEY environment variables."
								: "Set CONSOLE_PUBLIC_KEY and CONSOLE_SECRET_KEY to enable metrics from console.hanzo.ai."}
						</p>
						<div className="flex gap-2">
							<Button
								variant="outline"
								size="sm"
								onClick={() => window.open(CONSOLE_URL, "_blank")}
							>
								Open Console
								<ExternalLink className="ml-2 h-3 w-3" />
							</Button>
							<Button
								variant="outline"
								size="sm"
								onClick={() => window.open(O11Y_URL, "_blank")}
							>
								Open O11Y Dashboard
								<ExternalLink className="ml-2 h-3 w-3" />
							</Button>
						</div>
					</CardContent>
				</Card>
			) : (
				<>
					{/* Summary cards */}
					<div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
						<Card>
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="text-sm font-medium">
									Traces Today
								</CardTitle>
								<Zap className="h-4 w-4 text-muted-foreground" />
							</CardHeader>
							<CardContent>
								<div className="text-2xl font-bold">
									{formatNumber(metrics.totalTraces)}
								</div>
								<p className="text-xs text-muted-foreground">
									{formatNumber(metrics.totalObservations)} observations
								</p>
							</CardContent>
						</Card>

						<Card>
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="text-sm font-medium">
									Total Tokens
								</CardTitle>
								<MessageSquare className="h-4 w-4 text-muted-foreground" />
							</CardHeader>
							<CardContent>
								<div className="text-2xl font-bold">
									{formatNumber(metrics.totalTokens)}
								</div>
								<p className="text-xs text-muted-foreground">
									{formatNumber(metrics.inputTokens)} in /{" "}
									{formatNumber(metrics.outputTokens)} out
								</p>
							</CardContent>
						</Card>

						<Card>
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="text-sm font-medium">
									Cost Today
								</CardTitle>
								<Coins className="h-4 w-4 text-muted-foreground" />
							</CardHeader>
							<CardContent>
								<div className="text-2xl font-bold">
									{formatCost(metrics.totalCost)}
								</div>
								<p className="text-xs text-muted-foreground">
									Across all models
								</p>
							</CardContent>
						</Card>

						<Card>
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="text-sm font-medium">
									Models Used
								</CardTitle>
								<Activity className="h-4 w-4 text-muted-foreground" />
							</CardHeader>
							<CardContent>
								<div className="text-2xl font-bold">
									{metrics.modelUsage?.length ?? 0}
								</div>
								<p className="text-xs text-muted-foreground">
									Distinct models today
								</p>
							</CardContent>
						</Card>
					</div>

					{/* Model usage breakdown */}
					{metrics.modelUsage && metrics.modelUsage.length > 0 && (
						<Card>
							<CardHeader>
								<CardTitle className="text-lg">Model Usage</CardTitle>
								<CardDescription>
									Token usage and cost by model for today
								</CardDescription>
							</CardHeader>
							<CardContent>
								<div className="space-y-3">
									<div className="grid grid-cols-4 text-xs font-medium text-muted-foreground border-b pb-2">
										<span>Model</span>
										<span className="text-right">Requests</span>
										<span className="text-right">Tokens</span>
										<span className="text-right">Cost</span>
									</div>
									{metrics.modelUsage.map((model) => (
										<div
											key={model.model}
											className="grid grid-cols-4 text-sm items-center"
										>
											<span className="font-mono text-xs truncate pr-2">
												{model.model}
											</span>
											<span className="text-right">
												{formatNumber(model.count)}
											</span>
											<span className="text-right">
												{formatNumber(model.tokens)}
											</span>
											<span className="text-right">
												{formatCost(model.cost)}
											</span>
										</div>
									))}
								</div>
							</CardContent>
						</Card>
					)}
				</>
			)}
		</div>
	);
};
