import { Globe, Rocket, Search } from "lucide-react";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DnsRecords } from "./dns-records";
import { DomainVerify } from "./domain-verify";
import { PagesProjects } from "./pages-projects";

export const ShowDns = () => {
	return (
		<div className="w-full">
			<Card className="h-full bg-sidebar p-2.5 rounded-xl max-w-5xl mx-auto">
				<div className="rounded-xl bg-background shadow-md">
					<CardHeader>
						<CardTitle className="text-xl flex flex-row gap-2">
							<Globe className="size-6 text-muted-foreground self-center" />
							DNS & Pages
						</CardTitle>
						<CardDescription>
							Manage Cloudflare DNS records, Pages projects, and verify domain
							resolution
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-2 py-4 border-t">
						<Tabs defaultValue="records">
							<TabsList>
								<TabsTrigger value="records" className="flex items-center gap-1.5">
									<Globe className="size-3.5" />
									DNS Records
								</TabsTrigger>
								<TabsTrigger value="pages" className="flex items-center gap-1.5">
									<Rocket className="size-3.5" />
									Pages Projects
								</TabsTrigger>
								<TabsTrigger value="verify" className="flex items-center gap-1.5">
									<Search className="size-3.5" />
									Domain Verification
								</TabsTrigger>
							</TabsList>
							<TabsContent value="records" className="mt-4">
								<DnsRecords />
							</TabsContent>
							<TabsContent value="pages" className="mt-4">
								<PagesProjects />
							</TabsContent>
							<TabsContent value="verify" className="mt-4">
								<DomainVerify />
							</TabsContent>
						</Tabs>
					</CardContent>
				</div>
			</Card>
		</div>
	);
};
