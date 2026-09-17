import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";

/**
 * Hanzo Platform Control Plane & Self-Service API E2E Tests
 * Validates core health, OpenAPI specifications, OIDC discovery,
 * and authenticated customer self-service REST endpoints.
 */

function getCliToken(): string | null {
  if (process.env.HANZO_AUTH_TOKEN) return process.env.HANZO_AUTH_TOKEN;
  try {
    const token = execSync("hanzo auth token 2>/dev/null", { encoding: "utf8" }).trim();
    if (token && token.startsWith("ey")) return token;
  } catch {
    // CLI token not available
  }
  return null;
}

test.describe("Platform Health & API Plane", () => {
  test("GET /v1/health responds with 200 OK and revision", async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/v1/health`);
    expect(res.status()).toBe(200);
    const contentType = res.headers()["content-type"] || "";
    expect(contentType).toContain("application/json");

    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.revision).toBeTruthy();
    expect(typeof body.revision).toBe("string");
  });

  test("GET /v1/openapi.json provides complete Cloud API definition", async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/v1/openapi.json`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"] || "").toContain("application/json");

    const schema = await res.json();
    expect(schema.openapi).toMatch(/^3\./);
    expect(schema.info?.title).toContain("Hanzo Cloud API");
    expect(schema.info?.version).toBe("v1");

    const pathKeys = Object.keys(schema.paths || {});
    expect(pathKeys.length).toBeGreaterThan(1000);
    expect(pathKeys).toContain("/v1/projects");
    expect(pathKeys).toContain("/v1/models");
  });

  test("GET /v1/iam/.well-known/openid-configuration exposes RFC-compliant endpoints", async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/v1/iam/.well-known/openid-configuration`);
    expect(res.status()).toBe(200);

    const config = await res.json();
    expect(config.issuer).toBe("https://hanzo.id");
    expect(config.authorization_endpoint).toBeTruthy();
    expect(config.token_endpoint).toBeTruthy();
    expect(config.userinfo_endpoint).toBeTruthy();
    expect(config.code_challenge_methods_supported).toContain("S256");
    expect(config.response_types_supported).toContain("code");
  });

  test("Platform enforces HSTS and nosniff security headers", async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/v1/health`);
    const headers = res.headers();
    expect(headers["strict-transport-security"]).toBeTruthy();
    expect(headers["x-content-type-options"]).toBe("nosniff");
  });
});

test.describe("Customer Self-Service REST Endpoints (Authenticated)", () => {
  const token = getCliToken();

  test("GET /v1/projects lists customer projects and verifies live deployments", async ({ request, baseURL }) => {
    test.skip(!token, "Skipped: HANZO_AUTH_TOKEN or hanzo CLI login required");

    const res = await request.get(`${baseURL}/v1/projects`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const projects = await res.json();
    expect(Array.isArray(projects)).toBe(true);
    expect(projects.length).toBeGreaterThan(0);

    // Verify webby-ai and intel-hub projects exist in the customer workspace
    const projectSlugs = projects.map((p: any) => p.slug);
    expect(projectSlugs).toContain("webby-ai");
    expect(projectSlugs).toContain("intel-hub");

    const webbyAi = projects.find((p: any) => p.slug === "webby-ai");
    expect(webbyAi.status).toBe("live");
    expect(webbyAi.liveUrl).toBe("https://webby-ai.hanzo.app");

    const intelHub = projects.find((p: any) => p.slug === "intel-hub");
    expect(intelHub.status).toBe("live");
    expect(intelHub.liveUrl).toBe("https://intel-hub.hanzo.app");
  });

  test("GET /v1/projects/:slug/deployments retrieves customer release history", async ({ request, baseURL }) => {
    test.skip(!token, "Skipped: HANZO_AUTH_TOKEN or hanzo CLI login required");

    const res = await request.get(`${baseURL}/v1/projects/webby-ai/deployments`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const deployments = await res.json();
    expect(Array.isArray(deployments)).toBe(true);
    expect(deployments.length).toBeGreaterThanOrEqual(1);

    const latest = deployments[0];
    expect(latest.status).toBe("live");
    expect(latest.source).toBe("upload");
    expect(latest.liveUrl).toBe("https://webby-ai.hanzo.app");
  });

  test("Customer self-service access to AI models, Account, DNS, and Billing", async ({ request, baseURL }) => {
    test.setTimeout(60000);
    test.skip(!token, "Skipped: HANZO_AUTH_TOKEN or hanzo CLI login required");

    const headers = { Authorization: `Bearer ${token}` };

    // Models catalog (large payload with provider aggregations)
    const modelsRes = await request.get(`${baseURL}/v1/models`, { headers, timeout: 30000 });
    expect(modelsRes.status()).toBe(200);

    // Account information
    const accountRes = await request.get(`${baseURL}/v1/account`, { headers });
    expect(accountRes.status()).toBe(200);

    // DNS management
    const dnsRes = await request.get(`${baseURL}/v1/dns`, { headers });
    expect(dnsRes.status()).toBe(200);

    // Domains management
    const domainsRes = await request.get(`${baseURL}/v1/domains`, { headers });
    expect(domainsRes.status()).toBe(200);

    // Billing & Pricing
    const pricingRes = await request.get(`${baseURL}/v1/pricing/enablement`, { headers });
    expect(pricingRes.status()).toBe(200);
  });
});
