/**
 * Deployment Target Selector Component
 *
 * Allows users to choose between local Docker deployment
 * or Hanzo Cloud deployment with region selection.
 */

import { Label, RadioGroup, RadioGroupItem } from "@hanzo/ui";
import { Cloud, Server } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	HANZO_CLOUD_CONFIG,
	isHanzoCloudEnabled,
} from "@/lib/hanzo-cloud-config";

interface DeploymentTargetSelectorProps {
	onTargetChange: (target: {
		type: "local" | "cloud";
		region?: string;
	}) => void;
	defaultTarget?: "local" | "cloud";
	defaultRegion?: string;
}

export function DeploymentTargetSelector({
	onTargetChange,
	defaultTarget = "local",
	defaultRegion = "us-west-1",
}: DeploymentTargetSelectorProps) {
	const [selectedTarget, setSelectedTarget] = useState(defaultTarget);
	const [selectedRegion, setSelectedRegion] = useState(defaultRegion);

	const cloudEnabled = isHanzoCloudEnabled();
	const { deploymentTargets } = HANZO_CLOUD_CONFIG;

	const handleTargetChange = (value: string) => {
		setSelectedTarget(value as "local" | "cloud");
		onTargetChange({
			type: value as "local" | "cloud",
			region: value === "cloud" ? selectedRegion : undefined,
		});
	};

	const handleRegionChange = (value: string) => {
		setSelectedRegion(value);
		if (selectedTarget === "cloud") {
			onTargetChange({
				type: "cloud",
				region: value,
			});
		}
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>Deployment Target</CardTitle>
				<CardDescription>
					Choose where to deploy your application
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<RadioGroup value={selectedTarget} onValueChange={handleTargetChange}>
					{/* Local Docker Option */}
					{deploymentTargets.local.enabled && (
						<div className="flex items-start space-x-3">
							<RadioGroupItem value="local" id="local" />
							<Label htmlFor="local" className="flex-1 cursor-pointer">
								<div className="flex items-center space-x-2">
									<Server className="h-4 w-4" />
									<span className="font-medium">Local Docker</span>
									<Badge variant="secondary">Self-Hosted</Badge>
								</div>
								<p className="text-sm text-muted-foreground mt-1">
									Deploy to your local Docker environment
								</p>
							</Label>
						</div>
					)}

					{/* Hanzo Cloud Option */}
					{cloudEnabled && (
						<div className="flex items-start space-x-3">
							<RadioGroupItem value="cloud" id="cloud" />
							<Label htmlFor="cloud" className="flex-1 cursor-pointer">
								<div className="flex items-center space-x-2">
									<Cloud className="h-4 w-4" />
									<span className="font-medium">Hanzo Cloud</span>
									<Badge variant="default">Recommended</Badge>
								</div>
								<p className="text-sm text-muted-foreground mt-1">
									Deploy to Hanzo's global infrastructure with auto-scaling
								</p>
							</Label>
						</div>
					)}
				</RadioGroup>

				{/* Region Selection for Cloud Deployment */}
				{selectedTarget === "cloud" && deploymentTargets.hanzoCloud.regions && (
					<div className="pt-4 border-t">
						<Label htmlFor="region" className="text-sm font-medium">
							Select Region
						</Label>
						<Select value={selectedRegion} onValueChange={handleRegionChange}>
							<SelectTrigger id="region" className="mt-2">
								<SelectValue placeholder="Select a region" />
							</SelectTrigger>
							<SelectContent>
								{deploymentTargets.hanzoCloud.regions.map((region) => (
									<SelectItem key={region.id} value={region.id}>
										{region.name}
										<span className="text-xs text-muted-foreground ml-2">
											({region.id})
										</span>
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<p className="text-xs text-muted-foreground mt-2">
							Choose a region closest to your users for optimal performance
						</p>
					</div>
				)}

				{/* Feature Comparison */}
				{cloudEnabled && (
					<div className="pt-4 border-t">
						<h4 className="text-sm font-medium mb-3">Features</h4>
						<div className="space-y-2">
							{selectedTarget === "cloud" ? (
								<>
									<Feature included>Auto-scaling (1-10 replicas)</Feature>
									<Feature included>Global CDN</Feature>
									<Feature included>Automated backups</Feature>
									<Feature included>24/7 monitoring</Feature>
									<Feature included>SSL certificates</Feature>
									<Feature included>DDoS protection</Feature>
								</>
							) : (
								<>
									<Feature included>Full control</Feature>
									<Feature included>No vendor lock-in</Feature>
									<Feature included>Custom configurations</Feature>
									<Feature>Auto-scaling</Feature>
									<Feature>Managed backups</Feature>
									<Feature>Global CDN</Feature>
								</>
							)}
						</div>
					</div>
				)}
			</CardContent>
		</Card>
	);
}

function Feature({
	children,
	included = false,
}: {
	children: React.ReactNode;
	included?: boolean;
}) {
	return (
		<div
			className={`flex items-center text-sm ${included ? "" : "text-muted-foreground"}`}
		>
			<span className="mr-2">{included ? "✓" : "·"}</span>
			{children}
		</div>
	);
}
