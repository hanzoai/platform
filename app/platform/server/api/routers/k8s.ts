/**
 * Kubernetes deploy router — graft of Agnost GitOps K8s reconciler onto
 * the Hanzo platform. Exposes the already-ported low-level K8s service
 * surface from `@hanzo/platform/services/k8s` to the tRPC API so the
 * dashboard can manage K8s-deployed applications alongside the existing
 * Docker/Swarm and Hanzo Cloud paths.
 *
 * Companion to:
 *  - `pkg/platform/src/services/k8s/` — deployApplication / teardownApplication
 *  - `app/platform/server/api/routers/deployment.ts` — orchestrator that
 *    fans out to docker | cloud | k8s based on Application.deployTarget
 *
 * Ported semantics from cloud-agnost/agnost-gitops:
 *  - One namespace per environment (e.g. proj-hanzo-prod)
 *  - One Deployment + Service + Ingress per Application
 *  - Optional HPA, PVC, TLS via cert-manager
 */

import {
	deployApplication,
	teardownApplication,
	getApplicationStatus,
	getApplicationLogs,
	deployStack,
	type ApplicationSpec,
} from "@hanzo/platform/services/k8s";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";

// ───────────────────────────────────────────────────────────────────
// Zod input schemas — mirror ApplicationSpec but as tRPC inputs.
// ───────────────────────────────────────────────────────────────────

const envVarSchema = z.object({
	name: z.string().min(1),
	value: z.string(),
});

const resourceSpecSchema = z
	.object({
		cpuRequest: z.string().optional(),
		cpuLimit: z.string().optional(),
		memoryRequest: z.string().optional(),
		memoryLimit: z.string().optional(),
	})
	.optional();

const hpaSpecSchema = z
	.object({
		minReplicas: z.number().int().positive(),
		maxReplicas: z.number().int().positive(),
		cpuMetric: z
			.object({
				enabled: z.boolean(),
				metricType: z.string().optional(),
				metricValue: z.number().optional(),
			})
			.optional(),
		memoryMetric: z
			.object({
				enabled: z.boolean(),
				metricType: z.string().optional(),
				metricValue: z.number().optional(),
			})
			.optional(),
	})
	.optional();

const storageSpecSchema = z
	.object({
		mountPath: z.string().min(1),
		size: z.string().min(1),
		accessModes: z.array(z.string()).optional(),
	})
	.optional();

const applicationSpecSchema = z.object({
	name: z
		.string()
		.min(1)
		.max(63)
		.regex(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, "Must be lowercase RFC 1123"),
	image: z.string().min(1),
	containerPort: z.number().int().positive().max(65535),
	replicas: z.number().int().nonnegative().optional(),
	env: z.array(envVarSchema).optional(),
	resources: resourceSpecSchema,
	labels: z.record(z.string(), z.string()).optional(),
	hosts: z.array(z.string()).optional(),
	tls: z
		.array(
			z.object({
				hosts: z.array(z.string()).min(1),
				secretName: z.string().optional(),
			}),
		)
		.optional(),
	storage: storageSpecSchema,
	hpa: hpaSpecSchema,
});

const namespaceRegex = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const namespaceSchema = z
	.string()
	.min(1)
	.max(63)
	.regex(namespaceRegex, "Must be lowercase RFC 1123");

// kubeconfig is optional — when absent, in-cluster auth is used.
const kubeconfigSchema = z.string().optional();

// ───────────────────────────────────────────────────────────────────
// Router
// ───────────────────────────────────────────────────────────────────

export const k8sRouter = createTRPCRouter({
	/**
	 * Deploy an application to K8s.
	 * Creates: PVC (optional) + Service + Deployment + Ingress (optional) + HPA (optional).
	 */
	deploy: protectedProcedure
		.input(
			z.object({
				namespace: namespaceSchema,
				spec: applicationSpecSchema,
				kubeconfig: kubeconfigSchema,
			}),
		)
		.mutation(async ({ input }) => {
			try {
				await deployApplication(
					input.namespace,
					input.spec as ApplicationSpec,
					input.kubeconfig,
				);
				return { ok: true, namespace: input.namespace, name: input.spec.name };
			} catch (err) {
				if (err instanceof TRPCError) throw err;
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: `K8s deploy failed: ${(err as Error).message}`,
				});
			}
		}),

	/**
	 * Teardown an application — removes Deployment, StatefulSet, Service,
	 * Ingress, HPA, PVC matching the appName.
	 */
	teardown: protectedProcedure
		.input(
			z.object({
				namespace: namespaceSchema,
				name: z.string().min(1).regex(namespaceRegex),
				kubeconfig: kubeconfigSchema,
			}),
		)
		.mutation(async ({ input }) => {
			try {
				await teardownApplication(input.namespace, input.name, input.kubeconfig);
				return { ok: true, namespace: input.namespace, name: input.name };
			} catch (err) {
				if (err instanceof TRPCError) throw err;
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: `K8s teardown failed: ${(err as Error).message}`,
				});
			}
		}),

	/**
	 * Query application status — Deployment readiness plus existence of
	 * Service / Ingress / HPA companions.
	 */
	status: protectedProcedure
		.input(
			z.object({
				namespace: namespaceSchema,
				name: z.string().min(1).regex(namespaceRegex),
				kubeconfig: kubeconfigSchema,
			}),
		)
		.query(async ({ input }) => {
			try {
				const status = await getApplicationStatus(
					input.namespace,
					input.name,
					input.kubeconfig,
				);
				return { ok: true, status };
			} catch (err) {
				if (err instanceof TRPCError) throw err;
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: `K8s status failed: ${(err as Error).message}`,
				});
			}
		}),

	/**
	 * Stream-snapshot logs from an application's pods. Returns a map
	 * of pod name → tailLines (default 200) of log content.
	 */
	logs: protectedProcedure
		.input(
			z.object({
				namespace: namespaceSchema,
				name: z.string().min(1).regex(namespaceRegex),
				tailLines: z.number().int().positive().max(10000).optional(),
				container: z.string().optional(),
				previous: z.boolean().optional(),
				kubeconfig: kubeconfigSchema,
			}),
		)
		.query(async ({ input }) => {
			try {
				const logs = await getApplicationLogs(input.namespace, input.name, {
					tailLines: input.tailLines,
					container: input.container,
					previous: input.previous,
					kubeconfig: input.kubeconfig,
				});
				return { ok: true, logs };
			} catch (err) {
				if (err instanceof TRPCError) throw err;
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: `K8s logs failed: ${(err as Error).message}`,
				});
			}
		}),

	/**
	 * Deploy a one-click stack (from a rendered template under
	 * `pkg/platform/src/templates/k8s/stacks/`). The `iid` is the
	 * unique instance id used as a name prefix for all resources.
	 */
	deployStack: protectedProcedure
		.input(
			z.object({
				namespace: namespaceSchema,
				stack: z.string().min(1).max(64),
				iid: z.string().min(1).max(40),
				overrides: z.record(z.string(), z.unknown()).optional(),
				kubeconfig: kubeconfigSchema,
			}),
		)
		.mutation(async ({ input }) => {
			try {
				await deployStack(
					input.namespace,
					input.stack,
					{ iid: input.iid, ...(input.overrides ?? {}) } as Parameters<typeof deployStack>[2],
					input.kubeconfig,
				);
				return { ok: true, namespace: input.namespace, stack: input.stack };
			} catch (err) {
				if (err instanceof TRPCError) throw err;
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: `K8s stack deploy failed: ${(err as Error).message}`,
				});
			}
		}),
});
