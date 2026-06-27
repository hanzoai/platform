import { Cloud, Loader2, ServerCrash } from "lucide-react";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { api } from "@/utils/api";
import { AttachCluster } from "./attach-cluster";
import { ClusterCard } from "./cluster-card";
import { ProvisionCluster } from "./provision-cluster";

export const ShowDoks = () => {
	const utils = api.useUtils();
	const {
		data: clusters,
		isLoading,
		refetch,
	} = api.dedicatedCluster.list.useQuery();
	const { data: target } = api.dedicatedCluster.target.useQuery();

	// Refresh both the cluster list and the resolved deploy target after any
	// lifecycle action (provision/attach/delete/baseline/select land in the DB;
	// invalidating re-reads them through tRPC regardless of which client wrote).
	const refresh = () => {
		void refetch();
		void utils.dedicatedCluster.target.invalidate();
	};

	return (
		<div className="w-full">
			<Card className="h-full bg-sidebar p-2.5 rounded-xl max-w-5xl mx-auto">
				<div className="rounded-xl bg-background shadow-md">
					<CardHeader className="flex flex-row gap-2 justify-between w-full items-center flex-wrap">
						<div className="flex flex-col gap-2">
							<CardTitle className="text-xl flex flex-row gap-2">
								<Cloud className="size-6 text-muted-foreground self-center" />
								Clusters
							</CardTitle>
							<CardDescription>
								Provision dedicated Hanzo K8S clusters or attach your own — then
								point this organization's deploys at any of them.
							</CardDescription>
							<div className="text-sm text-muted-foreground">
								Deploy target:{" "}
								<span className="font-medium text-primary">
									{target?.dedicated
										? target.cluster
										: "Shared cluster (hanzo-k8s)"}
								</span>
							</div>
						</div>
						<div className="flex flex-row gap-2">
							<AttachCluster onSuccess={refresh} />
							<ProvisionCluster onSuccess={refresh} />
						</div>
					</CardHeader>
					<CardContent className="space-y-4 py-8 border-t min-h-[35vh]">
						{isLoading ? (
							<div className="flex items-center justify-center w-full h-[40vh]">
								<Loader2 className="size-8 animate-spin text-muted-foreground" />
							</div>
						) : clusters && clusters.length > 0 ? (
							<div className="flex flex-col gap-4">
								{clusters.map((cluster) => (
									<ClusterCard
										key={cluster.doksClusterId}
										cluster={cluster}
										onUpdate={refresh}
									/>
								))}
							</div>
						) : (
							<div className="flex flex-col items-center gap-3 py-12">
								<ServerCrash className="size-8 text-muted-foreground" />
								<span className="text-base text-muted-foreground">
									No clusters yet.
								</span>
								<span className="text-sm text-muted-foreground">
									Provision a dedicated cluster or attach your own to get
									started.
								</span>
							</div>
						)}
					</CardContent>
				</div>
			</Card>
		</div>
	);
};
