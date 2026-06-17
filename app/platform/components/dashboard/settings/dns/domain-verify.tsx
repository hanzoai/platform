import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Search, XCircle } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { AlertBlock } from "@/components/shared/alert-block";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { dns } from "@/utils/zap-dns";

const verifyDomainSchema = z.object({
	domain: z.string().min(1, "Domain is required"),
	expectedIp: z.string().optional(),
});

type VerifyDomainForm = z.infer<typeof verifyDomainSchema>;

interface VerifyResult {
	resolved: boolean;
	addresses: string[];
	matches: boolean;
	message: string;
}

export function DomainVerify() {
	const [result, setResult] = useState<VerifyResult | null>(null);
	const { mutateAsync, isPending } = dns.verifyDomain.useMutation();

	const form = useForm<VerifyDomainForm>({
		defaultValues: {
			domain: "",
			expectedIp: "",
		},
		resolver: zodResolver(verifyDomainSchema),
	});

	const onSubmit = async (data: VerifyDomainForm) => {
		setResult(null);
		await mutateAsync({
			domain: data.domain,
			expectedIp: data.expectedIp || undefined,
		})
			.then((res) => {
				setResult(res);
				if (res.resolved && res.matches) {
					toast.success("Domain resolves correctly");
				} else if (res.resolved && !res.matches) {
					toast.warning("Domain resolves but does not match expected IP");
				} else {
					toast.error("Domain does not resolve");
				}
			})
			.catch((err: Error) => {
				toast.error(err.message || "Failed to verify domain");
			});
	};

	return (
		<div className="space-y-4 max-w-2xl">
			<Card className="bg-sidebar">
				<CardHeader>
					<CardTitle className="text-base flex items-center gap-2">
						<Search className="size-5 text-muted-foreground" />
						DNS Lookup
					</CardTitle>
					<CardDescription>
						Verify that a domain resolves to the expected IP address
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Form {...form}>
						<form
							id="hook-form-verify-domain"
							onSubmit={form.handleSubmit(onSubmit)}
							className="grid w-full gap-4"
						>
							<FormField
								control={form.control}
								name="domain"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Domain</FormLabel>
										<FormControl>
											<Input placeholder="example.com" {...field} />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={form.control}
								name="expectedIp"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Expected IP (optional)</FormLabel>
										<FormControl>
											<Input placeholder="192.168.1.1" {...field} />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<div className="flex justify-end">
								<Button
									isLoading={isPending}
									form="hook-form-verify-domain"
									type="submit"
								>
									<Search className="h-4 w-4" />
									Verify
								</Button>
							</div>
						</form>
					</Form>
				</CardContent>
			</Card>

			{result && (
				<Card className="bg-sidebar">
					<CardContent className="pt-6 space-y-3">
						{result.resolved && result.matches ? (
							<AlertBlock type="success">{result.message}</AlertBlock>
						) : result.resolved && !result.matches ? (
							<AlertBlock type="warning">{result.message}</AlertBlock>
						) : (
							<AlertBlock type="error">{result.message}</AlertBlock>
						)}

						{result.addresses.length > 0 && (
							<div className="space-y-2">
								<span className="text-sm font-medium">Resolved Addresses</span>
								<div className="flex flex-wrap gap-2">
									{result.addresses.map((addr) => (
										<div
											key={addr}
											className="flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5"
										>
											{result.matches ? (
												<CheckCircle2 className="size-3.5 text-emerald-500" />
											) : (
												<XCircle className="size-3.5 text-orange-500" />
											)}
											<span className="text-sm font-mono">{addr}</span>
										</div>
									))}
								</div>
							</div>
						)}

						<div className="flex items-center gap-2 text-sm">
							<span className="text-muted-foreground">Status:</span>
							<Badge
								variant={
									result.resolved && result.matches
										? "green"
										: result.resolved
											? "yellow"
											: "red"
								}
							>
								{result.resolved && result.matches
									? "Verified"
									: result.resolved
										? "Mismatch"
										: "Unresolved"}
							</Badge>
						</div>
					</CardContent>
				</Card>
			)}
		</div>
	);
}
