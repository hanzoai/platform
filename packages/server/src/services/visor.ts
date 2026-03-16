import { TRPCError } from "@trpc/server";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const VISOR_API_URL =
	process.env.VISOR_API_URL ||
	"http://visor.hanzo.svc.cluster.local:19000";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function visorFetch<T>(
	path: string,
	token: string,
	options: {
		method?: "GET" | "POST" | "PUT" | "DELETE";
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
				: res.status === 409 ? "CONFLICT"
				: "BAD_REQUEST",
			message: `Visor API error (${res.status}): ${detail}`,
		});
	}

	return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// API methods
// ---------------------------------------------------------------------------

/** List all machines for an organization. */
export const visorListMachines = async (
	owner: string,
	token: string,
): Promise<VisorMachine[]> => {
	return visorFetch<VisorMachine[]>("/api/get-machines", token, {
		params: { owner },
	});
};

/** Get a single machine by owner and name. */
export const visorGetMachine = async (
	owner: string,
	name: string,
	token: string,
): Promise<VisorMachine> => {
	return visorFetch<VisorMachine>("/api/get-machine", token, {
		params: { id: `${owner}/${name}` },
	});
};

/** Create a new machine. */
export const visorCreateMachine = async (
	input: CreateMachineInput,
	token: string,
): Promise<VisorMachine> => {
	return visorFetch<VisorMachine>("/api/add-machine", token, {
		method: "POST",
		body: input,
	});
};

/** Update an existing machine. */
export const visorUpdateMachine = async (
	input: UpdateMachineInput,
	token: string,
): Promise<VisorMachine> => {
	return visorFetch<VisorMachine>("/api/update-machine", token, {
		method: "POST",
		body: input,
	});
};

/** Delete a machine. */
export const visorDeleteMachine = async (
	owner: string,
	name: string,
	token: string,
): Promise<{ success: boolean }> => {
	return visorFetch<{ success: boolean }>("/api/delete-machine", token, {
		method: "POST",
		body: { owner, name },
	});
};

/** List cloud providers configured for an organization. */
export const visorListProviders = async (
	owner: string,
	token: string,
): Promise<VisorProvider[]> => {
	return visorFetch<VisorProvider[]>("/api/get-providers", token, {
		params: { owner },
	});
};

/** List available plans (instance sizes). */
export const visorListPlans = async (
	token: string,
): Promise<VisorPlan[]> => {
	return visorFetch<VisorPlan[]>("/api/get-plans", token);
};

/** List node pools for an organization. */
export const visorListNodePools = async (
	owner: string,
	token: string,
): Promise<VisorNodePool[]> => {
	return visorFetch<VisorNodePool[]>("/api/get-node-pools", token, {
		params: { owner },
	});
};

/** List volumes for an organization. */
export const visorListVolumes = async (
	owner: string,
	token: string,
): Promise<VisorVolume[]> => {
	return visorFetch<VisorVolume[]>("/api/get-volumes", token, {
		params: { owner },
	});
};

/** Create a new volume. */
export const visorCreateVolume = async (
	input: CreateVolumeInput,
	token: string,
): Promise<VisorVolume> => {
	return visorFetch<VisorVolume>("/api/add-volume", token, {
		method: "POST",
		body: input,
	});
};

/** Delete a volume. */
export const visorDeleteVolume = async (
	owner: string,
	name: string,
	token: string,
): Promise<{ success: boolean }> => {
	return visorFetch<{ success: boolean }>("/api/delete-volume", token, {
		method: "POST",
		body: { owner, name },
	});
};
