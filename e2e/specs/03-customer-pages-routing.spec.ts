import { test, expect } from "@playwright/test";

/**
 * Platform Customer Pages & Route Wiring E2E Tests
 * Systematically proves that every customer self-service page route:
 * - Responds with HTTP 200 OK (no 404 dead links, no 500 server crashes)
 * - Returns valid HTML with proper dark theme configuration (#000000)
 * - Carries responsive viewport metadata
 * - Delivers application bundle chunks for hydration
 */

const WORKSPACE_ROUTES = [
  { path: "/dashboard", name: "Dashboard Root" },
  { path: "/dashboard/home", name: "Overview / Home" },
  { path: "/dashboard/projects", name: "Projects Management" },
  { path: "/dashboard/apps", name: "Apps & Fleet Inventory" },
  { path: "/dashboard/deploy", name: "Deployment Control Plane" },
  { path: "/dashboard/deployments", name: "Deployment History" },
  { path: "/dashboard/compose-editor", name: "Compose Multi-Service Editor" },
  { path: "/dashboard/services", name: "Managed Databases & Services" },
  { path: "/dashboard/templates", name: "One-Click Templates" },
  { path: "/dashboard/monitoring", name: "Resource Monitoring & Telemetry" },
];

const SETTINGS_SELF_SERVICE_ROUTES = [
  { path: "/dashboard/settings/profile", name: "Customer Profile & API Keys" },
  { path: "/dashboard/settings/billing", name: "Billing & Compute Credits" },
  { path: "/dashboard/settings/invoices", name: "Invoices & Payment History" },
  { path: "/dashboard/settings/dns", name: "Custom Domains & DNS Records" },
  { path: "/dashboard/settings/certificates", name: "TLS & SSL Certificates" },
  { path: "/dashboard/settings/git-providers", name: "Git Integrations (GitHub, GitLab)" },
  { path: "/dashboard/settings/registry", name: "Container Registry Credentials" },
  { path: "/dashboard/settings/ssh-keys", name: "SSH Keys Management" },
  { path: "/dashboard/settings/notifications", name: "Alerts & Webhook Notifications" },
  { path: "/dashboard/settings/audit-logs", name: "Security & Audit Logs" },
  { path: "/dashboard/settings/ai", name: "Zen AI & Model Gateway Settings" },
  { path: "/dashboard/settings/cluster", name: "Cluster & Infrastructure Topology" },
  { path: "/dashboard/settings/general", name: "General Workspace Settings" },
];

test.describe("Platform Customer Workspace Routes", () => {
  for (const { path, name } of WORKSPACE_ROUTES) {
    test(`Workspace page ${name} (${path}) serves 200 with valid dark theme shell`, async ({ request, baseURL }) => {
      const res = await request.get(`${baseURL}${path}`);
      expect(res.status(), `Route ${path} must respond with 200`).toBe(200);

      const contentType = res.headers()["content-type"] || "";
      expect(contentType).toContain("text/html");

      const html = await res.text();
      expect(html).toContain("<html");
      expect(html).toContain("t_dark");
      expect(html).toContain("#000000");
      expect(html).toContain('name="viewport"');
      expect(html).toContain("_next/static");
    });
  }
});

test.describe("Platform Customer Self-Service Settings Routes", () => {
  for (const { path, name } of SETTINGS_SELF_SERVICE_ROUTES) {
    test(`Self-service settings ${name} (${path}) serves 200 with valid shell`, async ({ request, baseURL }) => {
      const res = await request.get(`${baseURL}${path}`);
      expect(res.status(), `Route ${path} must respond with 200`).toBe(200);

      const contentType = res.headers()["content-type"] || "";
      expect(contentType).toContain("text/html");

      const html = await res.text();
      expect(html).toContain("<html");
      expect(html).toContain('name="viewport"');
      expect(html).toContain("_next/static");
    });
  }
});
