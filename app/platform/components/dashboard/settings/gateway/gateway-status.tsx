import { Bot, Cloud, Loader2, Router } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { gateway } from "@/utils/zap-gateway";

interface StatusCardProps {
	title: string;
	icon: React.ReactNode;
	healthy: boolean;
	error?: string;
	metrics: { label: string; value: number }[];
}

const StatusCard = ({ title, icon, healthy, error, metrics }: StatusCardProps) => (
	<Card>
		<CardHeader className="pb-2">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					{icon}
					<CardTitle className="text-base">{title}</CardTitle>
				</div>
				<Badge variant={healthy ? "green" : "red"}>
					{healthy ? "Healthy" : "Unhealthy"}
				</Badge>
			</div>
			{error && (
				<CardDescription className="text-destructive text-xs mt-1">
					{error}
				</CardDescription>
			)}
		</CardHeader>
		<CardContent>
			<div className="flex gap-6">
				{metrics.map((metric) => (
					<div key={metric.label} className="flex flex-col">
						<span className="text-2xl font-semibold tabular-nums">
							{metric.value}
						</span>
						<span className="text-xs text-muted-foreground">
							{metric.label}
						</span>
					</div>
				))}
			</div>
		</CardContent>
	</Card>
);

export const GatewayStatus = () => {
	const { data: status, isLoading } = gateway.status.useQuery(undefined, {
		refetchInterval: 30000,
	});

	if (isLoading) {
		return (
			<div className="flex flex-row gap-2 items-center justify-center text-sm text-muted-foreground min-h-[20vh]">
				<span>Loading status...</span>
				<Loader2 className="animate-spin size-4" />
			</div>
		);
	}

	if (!status) {
		return (
			<div className="flex items-center justify-center text-sm text-muted-foreground min-h-[20vh]">
				Unable to fetch gateway status
			</div>
		);
	}

	return (
		<div className="grid gap-4 md:grid-cols-3">
			<StatusCard
				title="Traefik"
				icon={<Router className="size-5 text-muted-foreground" />}
				healthy={status.traefik.healthy}
				error={status.traefik.error}
				metrics={[
					{ label: "Routers", value: status.traefik.routerCount },
					{ label: "Services", value: status.traefik.serviceCount },
				]}
			/>
			<StatusCard
				title="Cloud API"
				icon={<Cloud className="size-5 text-muted-foreground" />}
				healthy={status.cloudApi.healthy}
				error={status.cloudApi.error}
				metrics={[
					{
						label: "Active Connections",
						value: status.cloudApi.activeConnections,
					},
				]}
			/>
			<StatusCard
				title="Bot Gateway"
				icon={<Bot className="size-5 text-muted-foreground" />}
				healthy={status.botGateway.healthy}
				error={status.botGateway.error}
				metrics={[
					{
						label: "Connected Nodes",
						value: status.botGateway.connectedNodes,
					},
				]}
			/>
		</div>
	);
};
