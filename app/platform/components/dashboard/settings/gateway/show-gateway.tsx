import { Tabs, TabsContent, TabsList, TabsTrigger } from "@hanzo/ui";
import { Network } from "lucide-react";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { GatewayStatus } from "./gateway-status";
import { RateLimitTable } from "./rate-limit-table";
import { RoutingTable } from "./routing-table";

export const ShowGateway = () => {
	return (
		<div className="w-full">
			<Card className="h-full bg-sidebar p-2.5 rounded-xl max-w-5xl mx-auto">
				<div className="rounded-xl bg-background shadow-md">
					<CardHeader>
						<CardTitle className="text-xl flex flex-row gap-2">
							<Network className="size-6 text-muted-foreground self-center" />
							Gateway
						</CardTitle>
						<CardDescription>
							Monitor gateway health and manage rate limits and routing rules
						</CardDescription>
					</CardHeader>
					<CardContent className="border-t pt-6">
						<Tabs defaultValue="status">
							<TabsList className="mb-4">
								<TabsTrigger value="status">Status</TabsTrigger>
								<TabsTrigger value="rate-limits">Rate Limits</TabsTrigger>
								<TabsTrigger value="routes">Routes</TabsTrigger>
							</TabsList>

							<TabsContent value="status">
								<GatewayStatus />
							</TabsContent>

							<TabsContent value="rate-limits">
								<RateLimitTable />
							</TabsContent>

							<TabsContent value="routes">
								<RoutingTable />
							</TabsContent>
						</Tabs>
					</CardContent>
				</div>
			</Card>
		</div>
	);
};
