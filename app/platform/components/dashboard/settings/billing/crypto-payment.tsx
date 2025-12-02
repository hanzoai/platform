"use client";

import { useState, useCallback, useMemo } from "react";
import { useDynamicContext, useIsLoggedIn, useUserWallets } from "@dynamic-labs/sdk-react-core";
import { isEthereumWallet } from "@dynamic-labs/ethereum";
import { isSolanaWallet } from "@dynamic-labs/solana";
import { isBitcoinWallet } from "@dynamic-labs/bitcoin";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Loader2, Wallet, CheckCircle2, ExternalLink, Copy, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import {
	HANZO_ETH_ADDRESS,
	HANZO_SOL_ADDRESS,
	HANZO_BTC_ADDRESS,
	TOKEN_ADDRESSES,
	ERC20_ABI,
} from "@/lib/wagmi-config";
import { api } from "@/utils/api";

type PaymentMethod = "ETH" | "USDC_ETH" | "USDT_ETH" | "USDC_BASE" | "USDT_BASE" | "SOL" | "BTC";

interface CryptoPaymentProps {
	organizationId: string;
	onPaymentComplete?: () => void;
}

// Generate a unique amount with small random cents for payment matching
function generateUniqueAmount(baseAmount: number): number {
	const randomCents = Math.floor(Math.random() * 99) + 1;
	return baseAmount + randomCents / 100;
}

// Helper to convert ETH amount to wei (string)
function parseEtherAmount(amount: number): bigint {
	return BigInt(Math.floor(amount * 1e18));
}

// Helper to convert token amount to units (6 decimals for USDC/USDT)
function parseTokenAmount(amount: number, decimals: number = 6): bigint {
	return BigInt(Math.floor(amount * Math.pow(10, decimals)));
}

export function CryptoPayment({ organizationId, onPaymentComplete }: CryptoPaymentProps) {
	const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("ETH");
	const [amount, setAmount] = useState<string>("100");
	const [uniqueAmount, setUniqueAmount] = useState<number | null>(null);
	const [step, setStep] = useState<"select" | "confirm" | "pending" | "complete">("select");
	const [txHash, setTxHash] = useState<string | null>(null);
	const [isSending, setIsSending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Dynamic Labs hooks
	const { setShowAuthFlow } = useDynamicContext();
	const isLoggedIn = useIsLoggedIn();
	const userWallets = useUserWallets();

	// Get connected wallets by type
	const ethereumWallets = userWallets.filter(isEthereumWallet);
	const solanaWallets = userWallets.filter(isSolanaWallet);
	const bitcoinWallets = userWallets.filter(isBitcoinWallet);

	// Determine if we have the right wallet connected for the payment method
	const isEvmPayment = paymentMethod === "ETH" || paymentMethod.includes("USDC") || paymentMethod.includes("USDT");
	const isSolanaPayment = paymentMethod === "SOL";
	const isBitcoinPayment = paymentMethod === "BTC";

	const hasRequiredWallet = useMemo(() => {
		if (isEvmPayment) return ethereumWallets.length > 0;
		if (isSolanaPayment) return solanaWallets.length > 0;
		if (isBitcoinPayment) return bitcoinWallets.length > 0;
		return false;
	}, [isEvmPayment, isSolanaPayment, isBitcoinPayment, ethereumWallets.length, solanaWallets.length, bitcoinWallets.length]);

	// Get the appropriate wallet for the payment
	const activeWallet = useMemo(() => {
		if (isEvmPayment) return ethereumWallets[0];
		if (isSolanaPayment) return solanaWallets[0];
		if (isBitcoinPayment) return bitcoinWallets[0];
		return null;
	}, [isEvmPayment, isSolanaPayment, isBitcoinPayment, ethereumWallets, solanaWallets, bitcoinWallets]);

	// TRPC mutation to record pending payment
	const recordPendingPayment = api.billing.recordPendingCryptoPayment.useMutation();

	// Generate unique amount when moving to confirm step
	const handleProceedToConfirm = useCallback(() => {
		const baseAmt = parseFloat(amount);
		if (isNaN(baseAmt) || baseAmt <= 0) {
			toast.error("Please enter a valid amount");
			return;
		}
		const unique = generateUniqueAmount(baseAmt);
		setUniqueAmount(unique);
		setStep("confirm");
		setError(null);
	}, [amount]);

	// Send EVM payment (ETH or tokens)
	const sendEvmPayment = useCallback(async () => {
		if (!uniqueAmount || !activeWallet || !isEthereumWallet(activeWallet)) return;

		try {
			setIsSending(true);
			setError(null);
			setStep("pending");

			const walletClient = await activeWallet.getWalletClient();

			let hash: string;

			if (paymentMethod === "ETH") {
				// Send native ETH
				hash = await walletClient.sendTransaction({
					to: HANZO_ETH_ADDRESS as `0x${string}`,
					value: parseEtherAmount(uniqueAmount),
				});
			} else {
				// Send token (USDC/USDT)
				const chainId = paymentMethod.includes("BASE") ? 8453 : 1;
				const tokenType = paymentMethod.includes("USDC") ? "USDC" : "USDT";
				const tokenAddress = TOKEN_ADDRESSES[chainId as keyof typeof TOKEN_ADDRESSES][tokenType as "USDC" | "USDT"];

				hash = await walletClient.writeContract({
					address: tokenAddress as `0x${string}`,
					abi: ERC20_ABI,
					functionName: "transfer",
					args: [HANZO_ETH_ADDRESS as `0x${string}`, parseTokenAmount(uniqueAmount, 6)],
				});
			}

			setTxHash(hash);

			// Record the payment
			await recordPendingPayment.mutateAsync({
				organizationId,
				amount: Math.round(uniqueAmount * 100),
				currency: paymentMethod,
				txHash: hash,
				fromAddress: activeWallet.address,
			});

			setStep("complete");
			toast.success("Payment sent successfully!");
			onPaymentComplete?.();
		} catch (err: any) {
			console.error("EVM payment error:", err);
			setError(err.message || "Payment failed");
			setStep("confirm");
		} finally {
			setIsSending(false);
		}
	}, [uniqueAmount, activeWallet, paymentMethod, organizationId, recordPendingPayment, onPaymentComplete]);

	// Send Solana payment
	const sendSolanaPayment = useCallback(async () => {
		if (!uniqueAmount || !activeWallet || !isSolanaWallet(activeWallet)) return;

		try {
			setIsSending(true);
			setError(null);
			setStep("pending");

			const connection = await activeWallet.getConnection();
			const publicKey = activeWallet.address;

			if (!publicKey) {
				throw new Error("Wallet not connected");
			}

			// Create transfer instruction using Solana web3.js
			const { Transaction, SystemProgram, PublicKey, LAMPORTS_PER_SOL } = await import("@solana/web3.js");

			const transaction = new Transaction().add(
				SystemProgram.transfer({
					fromPubkey: new PublicKey(publicKey),
					toPubkey: new PublicKey(HANZO_SOL_ADDRESS),
					lamports: Math.floor(uniqueAmount * LAMPORTS_PER_SOL),
				})
			);

			// Get recent blockhash
			const { blockhash } = await connection.getLatestBlockhash();
			transaction.recentBlockhash = blockhash;
			transaction.feePayer = new PublicKey(publicKey);

			// Sign and send via Dynamic's wallet
			const signer = await activeWallet.getSigner();
			const signedTx = await signer.signTransaction(transaction);
			const signature = await connection.sendRawTransaction(signedTx.serialize());

			// Wait for confirmation
			await connection.confirmTransaction(signature, "confirmed");

			setTxHash(signature);

			// Record the payment
			await recordPendingPayment.mutateAsync({
				organizationId,
				amount: Math.round(uniqueAmount * 100),
				currency: "SOL",
				txHash: signature,
				fromAddress: publicKey,
			});

			setStep("complete");
			toast.success("Payment sent successfully!");
			onPaymentComplete?.();
		} catch (err: any) {
			console.error("Solana payment error:", err);
			setError(err.message || "Payment failed");
			setStep("confirm");
		} finally {
			setIsSending(false);
		}
	}, [uniqueAmount, activeWallet, organizationId, recordPendingPayment, onPaymentComplete]);

	// Handle payment based on method
	const handlePayment = useCallback(() => {
		if (isEvmPayment) {
			sendEvmPayment();
		} else if (isSolanaPayment) {
			sendSolanaPayment();
		} else if (isBitcoinPayment) {
			toast.info("Bitcoin payments require manual sending. Please copy the address below.");
		}
	}, [isEvmPayment, isSolanaPayment, isBitcoinPayment, sendEvmPayment, sendSolanaPayment]);

	// Copy address to clipboard
	const copyAddress = useCallback((address: string) => {
		navigator.clipboard.writeText(address);
		toast.success("Address copied!");
	}, []);

	// Get current explorer URL
	const getExplorerUrl = useCallback((hash: string) => {
		if (paymentMethod === "SOL") {
			return `https://solscan.io/tx/${hash}`;
		}
		if (paymentMethod === "BTC") {
			return `https://mempool.space/tx/${hash}`;
		}
		if (paymentMethod.includes("BASE")) {
			return `https://basescan.org/tx/${hash}`;
		}
		return `https://etherscan.io/tx/${hash}`;
	}, [paymentMethod]);

	// Get destination address based on payment method
	const getDestinationAddress = useCallback(() => {
		if (isEvmPayment) return HANZO_ETH_ADDRESS;
		if (isSolanaPayment) return HANZO_SOL_ADDRESS;
		if (isBitcoinPayment) return HANZO_BTC_ADDRESS;
		return "";
	}, [isEvmPayment, isSolanaPayment, isBitcoinPayment]);

	// Render wallet connection UI
	const renderWalletConnection = () => {
		if (!isLoggedIn || !hasRequiredWallet) {
			const walletType = isEvmPayment ? "Ethereum" : isSolanaPayment ? "Solana" : "Bitcoin";
			return (
				<div className="space-y-3">
					<Alert>
						<Wallet className="h-4 w-4" />
						<AlertDescription>
							Connect a {walletType} wallet to pay with {paymentMethod.replace("_", " on ")}
						</AlertDescription>
					</Alert>
					<Button onClick={() => setShowAuthFlow(true)} className="w-full">
						<Wallet className="h-4 w-4 mr-2" />
						Connect Wallet
					</Button>
				</div>
			);
		}

		return (
			<div className="space-y-3">
				<div className="flex items-center justify-between p-3 bg-muted rounded-lg">
					<div className="flex items-center gap-2">
						<Wallet className="h-4 w-4 text-muted-foreground" />
						<span className="text-sm font-mono">
							{activeWallet?.address?.slice(0, 6)}...{activeWallet?.address?.slice(-4)}
						</span>
					</div>
					<Badge variant="outline" className="text-green-600">
						Connected
					</Badge>
				</div>
			</div>
		);
	};

	// Render step content
	const renderStepContent = () => {
		switch (step) {
			case "select":
				return (
					<div className="space-y-6">
						<div className="space-y-2">
							<Label>Payment Method</Label>
							<Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="ETH">ETH (Ethereum)</SelectItem>
									<SelectItem value="USDC_ETH">USDC (Ethereum)</SelectItem>
									<SelectItem value="USDT_ETH">USDT (Ethereum)</SelectItem>
									<SelectItem value="USDC_BASE">USDC (Base)</SelectItem>
									<SelectItem value="USDT_BASE">USDT (Base)</SelectItem>
									<SelectItem value="SOL">SOL (Solana)</SelectItem>
									<SelectItem value="BTC">BTC (Bitcoin)</SelectItem>
								</SelectContent>
							</Select>
						</div>

						<div className="space-y-2">
							<Label>Amount (USD)</Label>
							<Input
								type="number"
								value={amount}
								onChange={(e) => setAmount(e.target.value)}
								placeholder="100"
								min="10"
							/>
							<p className="text-xs text-muted-foreground">
								Minimum: $10.00. A small random amount will be added for payment matching.
							</p>
						</div>

						{renderWalletConnection()}

						<Button
							onClick={handleProceedToConfirm}
							disabled={!hasRequiredWallet || !amount || parseFloat(amount) < 10}
							className="w-full"
						>
							Continue
						</Button>
					</div>
				);

			case "confirm":
				const destinationAddress = getDestinationAddress();
				const displayAmount = uniqueAmount?.toFixed(paymentMethod.includes("USD") ? 2 : 6);

				return (
					<div className="space-y-6">
						<Alert>
							<AlertDescription>
								{isBitcoinPayment
									? "Bitcoin payments must be sent manually. Copy the address below and send the exact amount from your wallet."
									: "Please confirm the payment details below. The unique amount helps us automatically credit your account."}
							</AlertDescription>
						</Alert>

						<div className="space-y-4">
							<div className="flex justify-between items-center p-3 bg-muted rounded-lg">
								<span className="text-sm text-muted-foreground">Payment Method</span>
								<span className="font-medium">{paymentMethod.replace("_", " on ")}</span>
							</div>

							<div className="flex justify-between items-center p-3 bg-muted rounded-lg">
								<span className="text-sm text-muted-foreground">Amount</span>
								<span className="font-medium font-mono">
									{displayAmount} {paymentMethod === "ETH" ? "ETH" : paymentMethod === "SOL" ? "SOL" : paymentMethod === "BTC" ? "BTC" : "USD"}
								</span>
							</div>

							<div className="p-3 bg-muted rounded-lg">
								<div className="flex justify-between items-center mb-2">
									<span className="text-sm text-muted-foreground">Destination</span>
									<Button
										variant="ghost"
										size="sm"
										onClick={() => copyAddress(destinationAddress)}
									>
										<Copy className="h-3 w-3 mr-1" />
										Copy
									</Button>
								</div>
								<span className="font-mono text-xs break-all">{destinationAddress}</span>
							</div>

							{!isBitcoinPayment && activeWallet && (
								<div className="flex justify-between items-center p-3 bg-muted rounded-lg">
									<span className="text-sm text-muted-foreground">From</span>
									<span className="font-mono text-sm">
										{activeWallet.address?.slice(0, 6)}...{activeWallet.address?.slice(-4)}
									</span>
								</div>
							)}
						</div>

						<div className="flex gap-3">
							<Button variant="outline" onClick={() => setStep("select")} className="flex-1">
								Back
							</Button>
							{isBitcoinPayment ? (
								<Button onClick={() => copyAddress(destinationAddress)} className="flex-1">
									<Copy className="h-4 w-4 mr-2" />
									Copy Address
								</Button>
							) : (
								<Button
									onClick={handlePayment}
									disabled={isSending}
									className="flex-1"
								>
									{isSending ? (
										<>
											<Loader2 className="h-4 w-4 mr-2 animate-spin" />
											Sending...
										</>
									) : (
										"Confirm & Send"
									)}
								</Button>
							)}
						</div>
					</div>
				);

			case "pending":
				return (
					<div className="space-y-6 text-center py-8">
						<Loader2 className="h-12 w-12 animate-spin mx-auto text-primary" />
						<div>
							<h3 className="font-semibold text-lg">Transaction Pending</h3>
							<p className="text-sm text-muted-foreground mt-1">
								Waiting for blockchain confirmation...
							</p>
						</div>
						{txHash && (
							<Button
								variant="outline"
								onClick={() => window.open(getExplorerUrl(txHash), "_blank")}
							>
								<ExternalLink className="h-4 w-4 mr-2" />
								View on Explorer
							</Button>
						)}
					</div>
				);

			case "complete":
				return (
					<div className="space-y-6 text-center py-8">
						<CheckCircle2 className="h-12 w-12 mx-auto text-green-600" />
						<div>
							<h3 className="font-semibold text-lg">Payment Complete!</h3>
							<p className="text-sm text-muted-foreground mt-1">
								Your credits will be added to your account shortly.
							</p>
						</div>
						{txHash && (
							<Button
								variant="outline"
								onClick={() => window.open(getExplorerUrl(txHash), "_blank")}
							>
								<ExternalLink className="h-4 w-4 mr-2" />
								View Transaction
							</Button>
						)}
						<Button onClick={() => {
							setStep("select");
							setUniqueAmount(null);
							setTxHash(null);
						}}>
							Make Another Payment
						</Button>
					</div>
				);
		}
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<Wallet className="h-5 w-5" />
					Pay with Crypto
				</CardTitle>
				<CardDescription>
					Connect your wallet and send crypto directly. Payments are automatically detected and credited.
				</CardDescription>
			</CardHeader>
			<CardContent>
				{error && (
					<Alert variant="destructive" className="mb-4">
						<AlertCircle className="h-4 w-4" />
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				)}
				{renderStepContent()}
			</CardContent>
		</Card>
	);
}
