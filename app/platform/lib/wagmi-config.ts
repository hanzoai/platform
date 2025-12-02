// Hanzo's receiving addresses for crypto payments
export const HANZO_ETH_ADDRESS = "0x21d3d8dF8364484F84e3aF6ae747B246b1a95c18" as const;
export const HANZO_SOL_ADDRESS = "ExrQv4qGZCMi4xoHMvEKk7S6Swr9LSRW3hG" as const;
export const HANZO_BTC_ADDRESS = "bc1qxzzjxwqqmx96rjywymtk2warau5g65tk44yerv" as const;

// USDC/USDT contract addresses
export const TOKEN_ADDRESSES = {
	// Ethereum Mainnet
	1: {
		USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
		USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
	},
	// Base
	8453: {
		USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
		USDT: "0x4c8D27c5B8D30a2a4C8Ed4C7D8a7E5f3B2C1A0D9", // Check correct address
	},
} as const;

// ERC20 ABI for transfer
export const ERC20_ABI = [
	{
		name: "transfer",
		type: "function",
		inputs: [
			{ name: "to", type: "address" },
			{ name: "amount", type: "uint256" },
		],
		outputs: [{ name: "", type: "bool" }],
	},
	{
		name: "balanceOf",
		type: "function",
		inputs: [{ name: "account", type: "address" }],
		outputs: [{ name: "", type: "uint256" }],
	},
	{
		name: "decimals",
		type: "function",
		inputs: [],
		outputs: [{ name: "", type: "uint8" }],
	},
	{
		name: "approve",
		type: "function",
		inputs: [
			{ name: "spender", type: "address" },
			{ name: "amount", type: "uint256" },
		],
		outputs: [{ name: "", type: "bool" }],
	},
] as const;
