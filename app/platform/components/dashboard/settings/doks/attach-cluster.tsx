import { Link2, Loader2 } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/utils/api";

interface Props {
	onSuccess: () => void;
}

/**
 * Attach a bring-your-own (external) Kubernetes cluster as a deploy target.
 * The pasted kubeconfig is sealed (AES-256-GCM) server-side before it is stored
 * and is never returned. The cluster is attached at `phase=requested`; the
 * operator + baseline are installed from the cluster card before it can be used.
 */
export const AttachCluster = ({ onSuccess }: Props) => {
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [kubeconfig, setKubeconfig] = useState("");

	const { mutateAsync: attach, isPending: attaching } =
		api.dedicatedCluster.attachExternal.useMutation();

	const handleAttach = async () => {
		try {
			await attach({ name: name.trim(), kubeconfig });
			toast.success(
				"Cluster attached — install the baseline to start using it",
			);
			setOpen(false);
			setName("");
			setKubeconfig("");
			onSuccess();
		} catch (error: any) {
			toast.error(error?.message || "Failed to attach cluster");
		}
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button variant="outline" className="cursor-pointer space-x-2">
					<Link2 className="h-4 w-4" />
					Attach Cluster
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Attach Your Own Cluster</DialogTitle>
					<DialogDescription>
						Bring any Kubernetes cluster — your own DOKS, bare-metal boxes, or
						any provider — under this organization as a deploy target. Paste its
						kubeconfig; it is encrypted at rest and never shown again.
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-4 py-4">
					<div className="flex flex-col gap-2">
						<Label htmlFor="clusterName">Cluster Name</Label>
						<Input
							id="clusterName"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="e.g. acme-prod"
						/>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="kubeconfig">Kubeconfig (YAML)</Label>
						<Textarea
							id="kubeconfig"
							value={kubeconfig}
							onChange={(e) => setKubeconfig(e.target.value)}
							placeholder={"apiVersion: v1\nkind: Config\nclusters:\n  - ..."}
							className="font-mono text-xs min-h-[180px]"
							spellCheck={false}
						/>
					</div>
				</div>
				<DialogFooter>
					<Button
						variant="secondary"
						onClick={() => setOpen(false)}
						disabled={attaching}
					>
						Cancel
					</Button>
					<Button
						onClick={handleAttach}
						disabled={attaching || !name.trim() || !kubeconfig.trim()}
					>
						{attaching ? (
							<>
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								Attaching...
							</>
						) : (
							"Attach"
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};
