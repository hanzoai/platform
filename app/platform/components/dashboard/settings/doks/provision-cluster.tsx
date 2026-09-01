import { Label, Switch } from "@hanzo/ui";
import { Loader2, PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { doks } from "@/utils/zap";

interface Props {
	onSuccess: () => void;
}

export const ProvisionCluster = ({ onSuccess }: Props) => {
	const [open, setOpen] = useState(false);
	const [region, setRegion] = useState("sfo3");
	const [nodeSize, setNodeSize] = useState("s-2vcpu-4gb");
	const [nodeCount, setNodeCount] = useState(2);
	const [ha, setHa] = useState(false);

	const { data: regions, isLoading: regionsLoading } =
		doks.listRegions.useQuery(undefined, { enabled: open });
	const { data: nodeSizes, isLoading: sizesLoading } =
		doks.listNodeSizes.useQuery(undefined, { enabled: open });

	const { mutateAsync: provision, isPending: provisioning } =
		doks.provision.useMutation();

	const handleProvision = async () => {
		try {
			await provision({
				region,
				nodeSize,
				nodeCount,
				ha,
			});
			toast.success("Cluster provisioning started");
			setOpen(false);
			resetForm();
			onSuccess();
		} catch (error: any) {
			toast.error(error?.message || "Failed to provision cluster");
		}
	};

	const resetForm = () => {
		setRegion("sfo3");
		setNodeSize("s-2vcpu-4gb");
		setNodeCount(2);
		setHa(false);
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button className="w-full cursor-pointer space-x-3">
					<PlusIcon className="h-4 w-4" />
					Provision Cluster
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Provision DOKS Cluster</DialogTitle>
					<DialogDescription>
						Create a new DigitalOcean Kubernetes cluster for your organization.
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-4 py-4">
					<div className="flex flex-col gap-2">
						<Label htmlFor="region">Region</Label>
						{regionsLoading ? (
							<div className="flex items-center gap-2 text-sm text-muted-foreground">
								<Loader2 className="size-4 animate-spin" />
								Loading regions...
							</div>
						) : (
							<Select value={region} onValueChange={setRegion}>
								<SelectTrigger>
									<SelectValue placeholder="Select region" />
								</SelectTrigger>
								<SelectContent>
									{regions?.map((r: any) => (
										<SelectItem key={r.slug} value={r.slug}>
											{r.name} ({r.slug})
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						)}
					</div>

					<div className="flex flex-col gap-2">
						<Label htmlFor="nodeSize">Node Size</Label>
						{sizesLoading ? (
							<div className="flex items-center gap-2 text-sm text-muted-foreground">
								<Loader2 className="size-4 animate-spin" />
								Loading node sizes...
							</div>
						) : (
							<Select value={nodeSize} onValueChange={setNodeSize}>
								<SelectTrigger>
									<SelectValue placeholder="Select node size" />
								</SelectTrigger>
								<SelectContent>
									{nodeSizes?.map((s: any) => (
										<SelectItem key={s.slug} value={s.slug}>
											{s.slug} - {s.vcpus} vCPU / {s.memory}MB / $
											{s.price_monthly}/mo
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						)}
					</div>

					<div className="flex flex-col gap-2">
						<Label htmlFor="nodeCount">Node Count</Label>
						<Input
							id="nodeCount"
							type="number"
							min={1}
							max={20}
							value={nodeCount}
							onChange={(e) => setNodeCount(Number(e.target.value))}
						/>
					</div>

					<div className="flex items-center justify-between">
						<div className="flex flex-col gap-1">
							<Label htmlFor="ha">High Availability</Label>
							<span className="text-xs text-muted-foreground">
								HA control plane with multiple master nodes
							</span>
						</div>
						<Switch id="ha" checked={ha} onCheckedChange={setHa} />
					</div>
				</div>
				<DialogFooter>
					<Button
						variant="secondary"
						onClick={() => setOpen(false)}
						disabled={provisioning}
					>
						Cancel
					</Button>
					<Button
						onClick={handleProvision}
						disabled={provisioning || regionsLoading || sizesLoading}
					>
						{provisioning ? (
							<>
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								Provisioning...
							</>
						) : (
							"Provision"
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};
