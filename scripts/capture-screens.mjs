import { chromium } from "playwright";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ARTIFACT_DIR = "/Users/a/.gemini/antigravity-cli/brain/db82692e-7c61-4055-8384-24cbd0deb118/screenshots";
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

function getCliToken() {
  if (process.env.HANZO_AUTH_TOKEN) return process.env.HANZO_AUTH_TOKEN;
  try {
    return execSync("hanzo auth token 2>/dev/null", { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

const token = getCliToken();
console.log("Using token:", token ? `${token.slice(0, 15)}...${token.slice(-10)}` : "NONE");

const screens = [
  // Platform screens
  { name: "platform-01-login", url: "https://platform.hanzo.ai/login", auth: false },
  { name: "platform-02-signup", url: "https://platform.hanzo.ai/signup", auth: false },
  { name: "platform-03-forget", url: "https://platform.hanzo.ai/forget", auth: false },
  { name: "platform-04-dashboard-home", url: "https://platform.hanzo.ai/dashboard/home", auth: true },
  { name: "platform-05-dashboard-projects", url: "https://platform.hanzo.ai/dashboard/projects", auth: true },
  { name: "platform-06-dashboard-apps", url: "https://platform.hanzo.ai/dashboard/apps", auth: true },
  { name: "platform-07-dashboard-deploy", url: "https://platform.hanzo.ai/dashboard/deploy", auth: true },
  { name: "platform-08-dashboard-deployments", url: "https://platform.hanzo.ai/dashboard/deployments", auth: true },
  { name: "platform-09-dashboard-monitoring", url: "https://platform.hanzo.ai/dashboard/monitoring", auth: true },
  { name: "platform-10-dashboard-services", url: "https://platform.hanzo.ai/dashboard/services", auth: true },
  { name: "platform-11-dashboard-templates", url: "https://platform.hanzo.ai/dashboard/templates", auth: true },
  { name: "platform-12-dashboard-compose-editor", url: "https://platform.hanzo.ai/dashboard/compose-editor", auth: true },
  { name: "platform-13-settings-profile", url: "https://platform.hanzo.ai/dashboard/settings/profile", auth: true },
  { name: "platform-14-settings-ai", url: "https://platform.hanzo.ai/dashboard/settings/ai", auth: true },
  { name: "platform-15-settings-billing", url: "https://platform.hanzo.ai/dashboard/settings/billing", auth: true },
  { name: "platform-16-settings-audit-logs", url: "https://platform.hanzo.ai/dashboard/settings/audit-logs", auth: true },
  { name: "platform-17-settings-cluster", url: "https://platform.hanzo.ai/dashboard/settings/cluster", auth: true },

  // Console screens
  { name: "console-01-home", url: "https://console.hanzo.ai/", auth: true },
  { name: "console-02-o11y-traces", url: "https://console.hanzo.ai/o11y", auth: true },
  { name: "console-03-logs", url: "https://console.hanzo.ai/logs", auth: true },
  { name: "console-04-errors", url: "https://console.hanzo.ai/errors", auth: true },
  { name: "console-05-ai-metrics", url: "https://console.hanzo.ai/ai-metrics", auth: true },
  { name: "console-06-code-repos", url: "https://console.hanzo.ai/code", auth: true },
  { name: "console-07-code-search", url: "https://console.hanzo.ai/code/search", auth: true },
  { name: "console-08-code-ask", url: "https://console.hanzo.ai/code/ask", auth: true },
];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1.5,
  });

  if (token) {
    await context.addCookies([
      {
        name: "hanzo_iam_access_token",
        value: token,
        domain: "platform.hanzo.ai",
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "Lax",
      },
      {
        name: "hanzo_iam_access_token",
        value: token,
        domain: "console.hanzo.ai",
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "Lax",
      },
      {
        name: "hanzo_iam_access_token",
        value: token,
        domain: ".hanzo.ai",
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
  }

  const page = await context.newPage();

  // Set localStorage init script
  if (token) {
    await page.addInitScript((t) => {
      try {
        localStorage.setItem("hanzo_iam_access_token", t);
        localStorage.setItem("hanzo_iam_id_token", t);
        localStorage.setItem("hanzo_iam_expires_at", String(Date.now() + 86400000 * 3));
        localStorage.setItem("hanzo.console.org", "hanzo");
        localStorage.setItem("hanzo.console.org.selected", "1");
        localStorage.setItem("hz_onboarding_done:hanzo", "1");
        sessionStorage.setItem("hz_onboarding_dismissed:hanzo", "1");
      } catch (e) {}
    }, token);
  }

  const results = [];

  for (const s of screens) {
    process.stdout.write(`Capturing ${s.name} (${s.url})... `);
    try {
      const resp = await page.goto(s.url, { waitUntil: "networkidle", timeout: 25000 }).catch(async () => {
        // Fallback to load state if networkidle times out
        return page.goto(s.url, { waitUntil: "domcontentloaded", timeout: 15000 });
      });

      // Allow 1s for CSS transitions & dynamic widgets
      await page.waitForTimeout(1200);

      const status = resp ? resp.status() : "N/A";
      const filePath = path.join(ARTIFACT_DIR, `${s.name}.png`);
      await page.screenshot({ path: filePath, fullPage: false });

      console.log(`OK [HTTP ${status}] -> ${filePath}`);
      results.push({ name: s.name, url: s.url, status, success: true, file: filePath });
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
      results.push({ name: s.name, url: s.url, status: "ERR", success: false, error: err.message });
    }
  }

  await browser.close();
  console.log("\nSummary:");
  console.log(`Total: ${results.length} screens`);
  console.log(`Success: ${results.filter(r => r.success).length}`);
  console.log(`Failed: ${results.filter(r => !r.success).length}`);
}

main().catch(console.error);
