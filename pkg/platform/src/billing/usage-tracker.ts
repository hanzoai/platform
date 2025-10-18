import Dockerode from "dockerode";
import { db } from "../db";
import { appUsageMetrics, application, projects } from "../db/schema";
import { eq } from "drizzle-orm";
import { calculateTotalUsageCost } from "./pricing";

const docker = new Dockerode();

function calculateCPUSeconds(stats: any, intervalSeconds: number): number {
  const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
  const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
  if (systemDelta <= 0 || cpuDelta <= 0) return 0;
  const cpuCount = stats.cpu_stats.online_cpus || 1;
  return ((cpuDelta / systemDelta) * cpuCount) * intervalSeconds;
}

function calculateMemoryGBSeconds(stats: any, intervalSeconds: number): number {
  return (stats.memory_stats.usage / (1024 ** 3)) * intervalSeconds;
}

function calculateEgressGB(stats: any): number {
  if (!stats.networks) return 0;
  let total = 0;
  for (const [_, net] of Object.entries(stats.networks)) {
    total += (net as any).tx_bytes;
  }
  return total / (1024 ** 3);
}

async function getStorageUsageGB(containerId: string): Promise<number> {
  try {
    const container = docker.getContainer(containerId);
    const inspect = await container.inspect();
    let totalGB = 0;
    
    if (inspect.Mounts) {
      for (const mount of inspect.Mounts) {
        try {
          const exec = await container.exec({
            Cmd: ["sh", "-c", `du -sb ${mount.Destination} 2>/dev/null || echo 0`],
            AttachStdout: true,
          });
          const stream = await exec.start({ hijack: true });
          let output = "";
          stream.on("data", (chunk: Buffer) => { output += chunk.toString(); });
          await new Promise(resolve => stream.on("end", resolve));
          const bytes = parseInt(output.trim().split(/\s+/)[0] || "0");
          totalGB += bytes / (1024 ** 3);
        } catch {}
      }
    }
    return totalGB;
  } catch {
    return 0;
  }
}

export async function collectApplicationMetrics(applicationId: string, intervalSeconds: number = 60) {
  try {
    const app = await db.query.application.findFirst({ where: eq(application.applicationId, applicationId) });
    if (!app?.appName) return;

    const containers = await docker.listContainers({
      filters: { label: [`com.docker.compose.service=${app.appName}`] },
    });
    if (containers.length === 0) return;

    const container = docker.getContainer(containers[0]!.Id);
    const stats = await container.stats({ stream: false });

    const cpuSeconds = calculateCPUSeconds(stats, intervalSeconds);
    const memoryGbSeconds = calculateMemoryGBSeconds(stats, intervalSeconds);
    const egressGb = calculateEgressGB(stats);
    const storageGb = await getStorageUsageGB(containers[0]!.Id);
    const storageGbSeconds = storageGb * intervalSeconds;

    const costs = calculateTotalUsageCost({ cpuSeconds, memoryGbSeconds, storageGbSeconds, egressGb });

    const project = await db.query.projects.findFirst({ where: eq(projects.projectId, app.projectId!) });
    if (!project) return;

    await db.insert(appUsageMetrics).values({
      applicationId,
      organizationId: project.organizationId,
      ownerId: project.userId,
      periodStart: new Date(Date.now() - intervalSeconds * 1000),
      periodEnd: new Date(),
      durationSeconds: intervalSeconds,
      cpuSeconds: cpuSeconds.toString(),
      memoryGbSeconds: memoryGbSeconds.toString(),
      storageGbSeconds: storageGbSeconds.toString(),
      egressGb: egressGb.toString(),
      cpuCost: costs.cpuCost.toString(),
      memoryCost: costs.memoryCost.toString(),
      storageCost: costs.storageCost.toString(),
      egressCost: costs.egressCost.toString(),
      totalCost: costs.totalCost.toString(),
    });
  } catch (error) {
    console.error(`Error collecting metrics for ${applicationId}:`, error);
  }
}

export async function collectAllApplicationsMetrics(intervalSeconds: number = 60) {
  const apps = await db.query.application.findMany();
  await Promise.allSettled(apps.map(app => collectApplicationMetrics(app.applicationId, intervalSeconds)));
}

export function startUsageCollectionSchedule() {
  console.log("Starting usage collection (every 60 seconds)...");
  setInterval(() => collectAllApplicationsMetrics(60), 60 * 1000);
  collectAllApplicationsMetrics(60);
}
