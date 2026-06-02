/**
 * Brand-scoped SMS/Email provider override.
 *
 * Lives at /dashboard/settings/notify-provider. Per-org. Admin only.
 *
 * What it does:
 *   - Shows the currently effective Plivo config (brand override vs Liquidity default).
 *   - Lets the brand admin set their own Plivo Auth ID / Token / Sender ID / From Email.
 *   - Sends a test SMS or email to a verified recipient.
 *   - Clears the override → brand falls back to the Liquidity default account.
 *
 * Secrets never round-trip the browser. The platform API forwards
 * mutations to notify, which writes them to KMS. The GET endpoint
 * returns only metadata (sender ID + from email + effective brand).
 */

import { standardSchemaResolver as zodResolver } from "@hookform/resolvers/standard-schema";
import { Loader2, MessageSquare, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
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
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { api } from "@/utils/api";

const overrideSchema = z.object({
	authId: z.string().min(1, "Plivo Auth ID is required"),
	authToken: z.string().min(1, "Plivo Auth Token is required"),
	senderId: z
		.string()
		.min(1, "Sender ID is required (E.164 number or Plivo Powerpack UUID)"),
	fromEmail: z
		.string()
		.email("Invalid email")
		.optional()
		.or(z.literal("")),
});

const testSchema = z.object({
	channel: z.enum(["sms", "email"]),
	recipient: z.string().min(1, "Recipient is required"),
});

type OverrideFormValues = z.infer<typeof overrideSchema>;
type TestFormValues = z.infer<typeof testSchema>;

export const BrandPlivoSettings = () => {
	const utils = api.useUtils();
	const { data, isLoading } = api.notifyProvider.get.useQuery();
	const setMutation = api.notifyProvider.set.useMutation({
		onSuccess: () => {
			toast.success("SMS/Email provider override saved");
			void utils.notifyProvider.get.invalidate();
		},
		onError: (err) => toast.error(err.message),
	});
	const clearMutation = api.notifyProvider.clear.useMutation({
		onSuccess: () => {
			toast.success("Override removed — using Liquidity default");
			void utils.notifyProvider.get.invalidate();
		},
		onError: (err) => toast.error(err.message),
	});
	const testMutation = api.notifyProvider.test.useMutation({
		onSuccess: (res) => {
			const id = res.message_id ?? "(no id)";
			toast.success(`Test sent — status=${res.status} id=${id}`);
		},
		onError: (err) => toast.error(err.message),
	});

	const overrideForm = useForm<OverrideFormValues>({
		resolver: zodResolver(overrideSchema),
		defaultValues: {
			authId: "",
			authToken: "",
			senderId: data?.senderId ?? "",
			fromEmail: data?.fromEmail ?? "",
		},
	});

	const [showTest, setShowTest] = useState(false);
	const testForm = useForm<TestFormValues>({
		resolver: zodResolver(testSchema),
		defaultValues: { channel: "sms", recipient: "" },
	});

	const onSaveOverride = async (values: OverrideFormValues) => {
		await setMutation.mutateAsync({
			authId: values.authId,
			authToken: values.authToken,
			senderId: values.senderId,
			fromEmail: values.fromEmail ?? "",
		});
	};

	const onSendTest = async (values: TestFormValues) => {
		await testMutation.mutateAsync(values);
	};

	const onClear = async () => {
		await clearMutation.mutateAsync();
	};

	if (isLoading) {
		return (
			<div
				data-testid="brand-plivo-loading"
				className="flex items-center justify-center min-h-[25vh] gap-2 text-muted-foreground"
			>
				<Loader2 className="animate-spin size-4" />
				<span>Loading provider configuration…</span>
			</div>
		);
	}

	const effective = data?.effectiveBrand ?? "liquidity";
	const isOverride = Boolean(data?.hasOverride);

	return (
		<div className="w-full max-w-5xl mx-auto" data-testid="brand-plivo-settings">
			<Card className="bg-sidebar p-2.5 rounded-xl">
				<div className="rounded-xl bg-background shadow-md">
					<CardHeader>
						<div className="flex items-center justify-between">
							<div>
								<CardTitle className="text-xl flex flex-row gap-2">
									<MessageSquare className="size-6 text-muted-foreground self-center" />
									SMS / Email Provider Override
								</CardTitle>
								<CardDescription className="mt-1">
									Override the default Plivo account used for SMS and email
									notifications for this organization. Until you save an
									override, this brand uses the platform&apos;s default Plivo
									account.
								</CardDescription>
							</div>
							<div
								className="flex flex-col items-end gap-1"
								data-testid="effective-provider"
							>
								<span className="text-xs text-muted-foreground">
									Currently using
								</span>
								{isOverride ? (
									<Badge variant="default" data-testid="badge-override">
										Brand override ({effective})
									</Badge>
								) : (
									<Badge variant="secondary" data-testid="badge-default">
										Liquidity default
									</Badge>
								)}
							</div>
						</div>
					</CardHeader>
					<CardContent className="space-y-6 py-6 border-t">
						<Form {...overrideForm}>
							<form
								onSubmit={overrideForm.handleSubmit(onSaveOverride)}
								className="space-y-4"
								data-testid="form-override"
							>
								<FormField
									control={overrideForm.control}
									name="authId"
									render={({ field }) => (
										<FormItem>
											<FormLabel>Plivo Auth ID</FormLabel>
											<FormControl>
												<Input
													{...field}
													placeholder="MAxxxxxxxxxxxx"
													data-testid="input-auth-id"
												/>
											</FormControl>
											<FormDescription>
												Found in your Plivo console under Account.
											</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>
								<FormField
									control={overrideForm.control}
									name="authToken"
									render={({ field }) => (
										<FormItem>
											<FormLabel>Plivo Auth Token</FormLabel>
											<FormControl>
												<Input
													{...field}
													type="password"
													placeholder="••••••••"
													data-testid="input-auth-token"
												/>
											</FormControl>
											<FormDescription>
												Stored in KMS at brand/&lt;slug&gt;/plivo. Never exposed
												back to this UI.
											</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>
								<FormField
									control={overrideForm.control}
									name="senderId"
									render={({ field }) => (
										<FormItem>
											<FormLabel>Sender ID</FormLabel>
											<FormControl>
												<Input
													{...field}
													placeholder="+15555550100 or Powerpack UUID"
													data-testid="input-sender-id"
												/>
											</FormControl>
											<FormDescription>
												E.164 phone number or Plivo Powerpack UUID. Appears as
												the From on the SMS.
											</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>
								<FormField
									control={overrideForm.control}
									name="fromEmail"
									render={({ field }) => (
										<FormItem>
											<FormLabel>From Email (optional)</FormLabel>
											<FormControl>
												<Input
													{...field}
													type="email"
													placeholder="noreply@yourbrand.com"
													data-testid="input-from-email"
												/>
											</FormControl>
											<FormDescription>
												Used when notify channel=email is routed to this
												provider. Leave blank to inherit.
											</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>
								<div className="flex items-center gap-2">
									<Button
										type="submit"
										disabled={setMutation.isPending}
										data-testid="btn-save"
									>
										{setMutation.isPending && (
											<Loader2 className="size-4 animate-spin mr-2" />
										)}
										Save override
									</Button>
									{isOverride && (
										<Button
											type="button"
											variant="destructive"
											onClick={onClear}
											disabled={clearMutation.isPending}
											data-testid="btn-clear"
										>
											{clearMutation.isPending ? (
												<Loader2 className="size-4 animate-spin mr-2" />
											) : (
												<Trash2 className="size-4 mr-2" />
											)}
											Remove override
										</Button>
									)}
									<Button
										type="button"
										variant="outline"
										onClick={() => setShowTest((v) => !v)}
										data-testid="btn-show-test"
									>
										{showTest ? "Hide test" : "Test"}
									</Button>
								</div>
							</form>
						</Form>

						{showTest && (
							<div
								className="border rounded-md p-4 mt-2"
								data-testid="test-panel"
							>
								<Form {...testForm}>
									<form
										onSubmit={testForm.handleSubmit(onSendTest)}
										className="space-y-3"
									>
										<FormField
											control={testForm.control}
											name="channel"
											render={({ field }) => (
												<FormItem>
													<FormLabel>Channel</FormLabel>
													<Select
														onValueChange={field.onChange}
														value={field.value}
													>
														<FormControl>
															<SelectTrigger data-testid="select-channel">
																<SelectValue />
															</SelectTrigger>
														</FormControl>
														<SelectContent>
															<SelectItem value="sms">SMS</SelectItem>
															<SelectItem value="email">Email</SelectItem>
														</SelectContent>
													</Select>
													<FormMessage />
												</FormItem>
											)}
										/>
										<FormField
											control={testForm.control}
											name="recipient"
											render={({ field }) => (
												<FormItem>
													<FormLabel>Recipient</FormLabel>
													<FormControl>
														<Input
															{...field}
															placeholder="+15555550100 or test@example.com"
															data-testid="input-test-recipient"
														/>
													</FormControl>
													<FormDescription>
														Sent via the effective provider (override or
														Liquidity default).
													</FormDescription>
													<FormMessage />
												</FormItem>
											)}
										/>
										<Button
											type="submit"
											disabled={testMutation.isPending}
											data-testid="btn-send-test"
										>
											{testMutation.isPending ? (
												<Loader2 className="size-4 animate-spin mr-2" />
											) : (
												<Send className="size-4 mr-2" />
											)}
											Send test
										</Button>
									</form>
								</Form>
							</div>
						)}
					</CardContent>
				</div>
			</Card>
		</div>
	);
};
