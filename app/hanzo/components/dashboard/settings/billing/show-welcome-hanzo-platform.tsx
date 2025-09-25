import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function ShowWelcomeHanzoPlatform() {
	return (
		<Card className="border-2 border-primary">
			<CardHeader>
				<CardTitle className="text-2xl">Welcome to Hanzo Platform</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<p>Deploy and manage your applications with ease.</p>
				<div className="space-y-2">
					<h3 className="font-semibold">Get Started:</h3>
					<ul className="list-disc list-inside space-y-1">
						<li>Create your first project</li>
						<li>Deploy applications</li>
						<li>Manage databases</li>
						<li>Configure domains</li>
					</ul>
				</div>
			</CardContent>
		</Card>
	);
}