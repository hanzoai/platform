import { Cloud, Loader2, ServerCrash } from "lucide-react";
import { useMemo } from "react";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { doks } from "@/utils/zap";
import { ClusterCard } from "./cluster-card";
import { ProvisionCluster } from "./provision-cluster";

export const ShowDoks = () => {
	const { data: clusterData, isLoading, refetch } = doks.getByOrg.useQuery();

	// getByOrg returns a single cluster or null; normalize to array
	const clusters = useMemo(() => {
		if (!clusterData) return [];
		return [clusterData];
	}, [clusterData]);

	return (
		<div className="w-full">
			<Card className="h-full bg-sidebar p-2.5 rounded-xl max-w-5xl mx-auto">
				<div className="rounded-xl bg-background shadow-md">
					<CardHeader className="flex flex-row gap-2 justify-between w-full items-center flex-wrap">
						<div className="flex flex-col gap-2">
							<CardTitle className="text-xl flex flex-row gap-2">
								<Cloud className="size-6 text-muted-foreground self-center" />
								DOKS Clusters
							</CardTitle>
							<CardDescription>
								Provision and manage DigitalOcean Kubernetes clusters
							</CardDescription>
						</div>
						<div className="flex flex-row gap-2">
							<ProvisionCluster onSuccess={() => refetch()} />
						</div>
					</CardHeader>
					<CardContent className="space-y-4 py-8 border-t min-h-[35vh]">
						{isLoading ? (
							<div className="flex items-center justify-center w-full h-[40vh]">
								<Loader2 className="size-8 animate-spin text-muted-foreground" />
							</div>
						) : clusters.length > 0 ? (
							<div className="flex flex-col gap-4">
								{clusters.map((cluster) => (
									<ClusterCard
										key={cluster.doksClusterId}
										cluster={cluster}
										onUpdate={() => refetch()}
									/>
								))}
							</div>
						) : (
							<div className="flex flex-col items-center gap-3 py-12">
								<ServerCrash className="size-8 text-muted-foreground" />
								<span className="text-base text-muted-foreground">
									No DOKS clusters provisioned yet.
								</span>
								<span className="text-sm text-muted-foreground">
									Click "Provision Cluster" to create your first Kubernetes
									cluster.
								</span>
							</div>
						)}
					</CardContent>
				</div>
			</Card>
		</div>
	);
};
