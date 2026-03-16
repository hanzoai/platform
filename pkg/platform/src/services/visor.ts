/**
 * Visor API client for unified cloud instance management.
 * Delegates VM/instance/cluster operations to the Visor service.
 */
import { TRPCError } from "@trpc/server";

const VISOR_API_URL =
	process.env.VISOR_API_URL ||
	"http://visor.hanzo.svc.cluster.local:19000";

export interface VisorMachine {
	id: string;
	name: string;
	owner: string;
	provider: string;
	region: string;
	size: string;
	status: string;
	publicIp?: string;
	privateIp?: string;
	createdAt: string;
	updatedAt: string;
	labels?: Record<string, string>;
	[key: string]: unknown;
}

export interface VisorProvider {
	id: string;
	name: string;
	type: string;
	owner: string;
	isActive: boolean;
	[key: string]: unknown;
}

export interface VisorPlan {
	id: string;
	name: string;
	slug: string;
	vcpus: number;
	memory: number;
	disk: number;
	priceMonthly: number;
	[key: string]: unknown;
}

export interface VisorNodePool {
	id: string;
	name: string;
	owner: string;
	size: string;
	count: number;
	status: string;
	[key: string]: unknown;
}

export interface VisorVolume {
	id: string;
	name: string;
	owner: string;
	sizeGb: number;
	region: string;
	status: string;
	attachedTo?: string;
	[key: string]: unknown;
}

export interface CreateMachineInput {
	owner: string;
	name: string;
	provider: string;
	region: string;
	size: string;
	image?: string;
	labels?: Record<string, string>;
	userData?: string;
}

export interface UpdateMachineInput {
	owner: string;
	name: string;
	size?: string;
	labels?: Record<string, string>;
	[key: string]: unknown;
}

export interface CreateVolumeInput {
	owner: string;
	name: string;
	sizeGb: number;
	region: string;
}

async function visorFetch<T>(
	path: string,
	token: string,
	options: {
		method?: "GET" | "POST";
		body?: unknown;
		params?: Record<string, string>;
	} = {},
): Promise<T> {
	const url = new URL(path, VISOR_API_URL);
	if (options.params) {
		for (const [k, v] of Object.entries(options.params)) {
			url.searchParams.set(k, v);
		}
	}
	const init: RequestInit = {
		method: options.method ?? "GET",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${token}`,
		},
	};
	if (options.body !== undefined) {
		init.body = JSON.stringify(options.body);
	}
	let res: Response;
	try {
		res = await fetch(url.toString(), init);
	} catch (err) {
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: `Visor API unreachable: ${err instanceof Error ? err.message : String(err)}`,
		});
	}
	if (!res.ok) {
		let detail: string;
		try {
			const body = (await res.json()) as { message?: string; error?: string };
			detail = body.message || body.error || res.statusText;
		} catch {
			detail = res.statusText;
		}
		throw new TRPCError({
			code: res.status === 401 ? "UNAUTHORIZED"
				: res.status === 403 ? "FORBIDDEN"
				: res.status === 404 ? "NOT_FOUND"
				: "BAD_REQUEST",
			message: `Visor API error (${res.status}): ${detail}`,
		});
	}
	return (await res.json()) as T;
}

export const visorListMachines = (owner: string, token: string) =>
	visorFetch<VisorMachine[]>("/api/get-machines", token, { params: { owner } });

export const visorGetMachine = (owner: string, name: string, token: string) =>
	visorFetch<VisorMachine>("/api/get-machine", token, { params: { id: `${owner}/${name}` } });

export const visorCreateMachine = (input: CreateMachineInput, token: string) =>
	visorFetch<VisorMachine>("/api/add-machine", token, { method: "POST", body: input });

export const visorUpdateMachine = (input: UpdateMachineInput, token: string) =>
	visorFetch<VisorMachine>("/api/update-machine", token, { method: "POST", body: input });

export const visorDeleteMachine = (owner: string, name: string, token: string) =>
	visorFetch<{ success: boolean }>("/api/delete-machine", token, { method: "POST", body: { owner, name } });

export const visorListProviders = (owner: string, token: string) =>
	visorFetch<VisorProvider[]>("/api/get-providers", token, { params: { owner } });

export const visorListPlans = (token: string) =>
	visorFetch<VisorPlan[]>("/api/get-plans", token);

export const visorListNodePools = (owner: string, token: string) =>
	visorFetch<VisorNodePool[]>("/api/get-node-pools", token, { params: { owner } });

export const visorListVolumes = (owner: string, token: string) =>
	visorFetch<VisorVolume[]>("/api/get-volumes", token, { params: { owner } });

export const visorCreateVolume = (input: CreateVolumeInput, token: string) =>
	visorFetch<VisorVolume>("/api/add-volume", token, { method: "POST", body: input });

export const visorDeleteVolume = (owner: string, name: string, token: string) =>
	visorFetch<{ success: boolean }>("/api/delete-volume", token, { method: "POST", body: { owner, name } });
