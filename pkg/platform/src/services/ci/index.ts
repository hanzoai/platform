/**
 * Platform-native CI/CD — barrel.
 *
 * Webhook → BuildScheduler → arcd → DeployExecutor. This module is the
 * platform's escape hatch from GitHub Actions as a single point of failure:
 * platform owns the build+deploy system-of-record (the buildJob table), the
 * deploy decision, and the rollout, dispatching build work to self-hosted
 * arcd runner pools.
 */

export * from "./arcd-runner";
export * from "./build-completion";
export * from "./build-job";
export * from "./build-queue";
export * from "./build-scheduler";
export * from "./deploy-executor";
export * from "./github-webhook";
export * from "./image-ref";
export * from "./platform-config";
