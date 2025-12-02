"use client";

import { DynamicContextProvider } from "@dynamic-labs/sdk-react-core";
import { BitcoinWalletConnectors } from "@dynamic-labs/bitcoin";
import { EthereumWalletConnectors } from "@dynamic-labs/ethereum";
import { SolanaWalletConnectors } from "@dynamic-labs/solana";
import type { ReactNode } from "react";

interface WalletProviderProps {
	children: ReactNode;
}

// Dynamic Labs Environment ID - use same for dev and production
const DYNAMIC_ENVIRONMENT_ID = "ba496edd-716a-428e-be75-5326dedd29d6";

export function WalletProvider({ children }: WalletProviderProps) {
	return (
		<DynamicContextProvider
			settings={{
				environmentId: DYNAMIC_ENVIRONMENT_ID,
				walletConnectors: [
					BitcoinWalletConnectors,
					EthereumWalletConnectors,
					SolanaWalletConnectors,
				],
			}}
		>
			{children}
		</DynamicContextProvider>
	);
}
