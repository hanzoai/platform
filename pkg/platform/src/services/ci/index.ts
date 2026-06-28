/**
 * Platform-native CI/CD — barrel.
 *
 * Webhook / direct-trigger → BuildScheduler → BuildKit build Job → build-watcher
 * → DeployExecutor → e2e Job → publish Job. Platform owns the build+deploy+test
 * +publish system-of-record (the buildJob table), the deploy decision, and the
 * rollout, executing every stage as an in-cluster Job on its own runner pool —
 * never via GitHub Actions.
 */

export * from "./build-completion";
export * from "./build-job";
export * from "./build-scheduler";
export * from "./build-watcher";
export * from "./deploy-executor";
export * from "./e2e-runner";
export * from "./github-webhook";
export * from "./image-ref";
export * from "./buildkit-job";
export * from "./platform-config";
export * from "./publish-job";
