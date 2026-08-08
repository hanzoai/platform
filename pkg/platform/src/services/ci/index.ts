/**
 * Platform-native CI/CD — barrel.
 *
 * Git-forge webhook (Hanzo Git or GitHub — one normalized shape) /
 * direct-trigger → BuildScheduler → BuildKit build Job → build-watcher
 * → smoke → pin → e2e Job → publish Job. Platform owns the build+deploy+test
 * +publish system-of-record (the buildJob table) and executes every stage as an
 * in-cluster Job on its own runner pool — never via GitHub Actions.
 *
 * It does NOT roll anything out. Promotion is a commit to the universe values
 * file; cd.hanzo.ai reconciles from there. Platform describes production, it
 * does not write it.
 */

export * from "./build-completion";
export * from "./build-job";
export * from "./build-scheduler";
export * from "./build-watcher";
export * from "./buildkit-job";
export * from "./e2e-runner";
export * from "./git-webhook";
export * from "./image-ref";
export * from "./pin";
export * from "./platform-config";
export * from "./promote";
export * from "./publish-job";
export * from "./smoke-runner";
