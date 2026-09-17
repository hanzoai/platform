import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";

/**
 * Hanzo Platform Observability, Telemetry & Agentic Coding E2E Tests
 * Validates:
 * 1. Distributed Tracing & Span OpenTelemetry schema (/v1/o11y/traces/fields, /v1/o11y/trace-funnels, /v1/o11y/span_mapper_groups)
 * 2. Logging & Metrics streams (/v1/o11y/metrics, /v1/o11y/logs, /v1/o11y/services/list, /v1/o11y/alerts)
 * 3. AI Observability & Agentic Coding Telemetry (/v1/agent/activity, /v1/agent/metrics, /v1/agent/builds)
 * 4. Tool & Prompt Catalogs (/v1/tool/catalog, /v1/prompt/catalog, /v1/prompt/metrics)
 * 5. Project Telemetry Binding for customer org (webby-ai & intel-hub analytics: true)
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

test.describe("Observability (O11y) & Agentic Coding Pipeline", () => {
  let token: string | null;

  test.beforeAll(() => {
    token = getCliToken();
  });

  test("GET /v1/o11y/traces/fields exposes full OpenTelemetry trace & span schema", async ({ request, baseURL }) => {
    test.skip(!token, "Requires authenticated Hanzo session token");
    const base = baseURL || "https://platform.hanzo.ai";

    const res = await request.get(`${base}/v1/o11y/traces/fields`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.selected)).toBe(true);
    expect(body.selected.length).toBeGreaterThan(15);

    const fieldNames = body.selected.map((f: { name: string }) => f.name);
    // Core OpenTelemetry fields
    expect(fieldNames).toContain("trace_id");
    expect(fieldNames).toContain("span_id");
    expect(fieldNames).toContain("duration_nano");
    expect(fieldNames).toContain("kind_string");
    expect(fieldNames).toContain("status_code");
    expect(fieldNames).toContain("has_error");
    expect(fieldNames).toContain("resource_string_service$$name");
  });

  test("GET /v1/o11y/trace-funnels/list returns funnel analytics status", async ({ request, baseURL }) => {
    test.skip(!token, "Requires authenticated Hanzo session token");
    const base = baseURL || "https://platform.hanzo.ai";

    const res = await request.get(`${base}/v1/o11y/trace-funnels/list`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("success");
  });

  test("GET /v1/o11y/span_mapper_groups returns span mapping configuration", async ({ request, baseURL }) => {
    test.skip(!token, "Requires authenticated Hanzo session token");
    const base = baseURL || "https://platform.hanzo.ai";

    const res = await request.get(`${base}/v1/o11y/span_mapper_groups`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("success");
    expect(body.data).toBeDefined();
  });

  test("GET /v1/o11y/metrics returns live telemetry metrics payload", async ({ request, baseURL }) => {
    test.skip(!token, "Requires authenticated Hanzo session token");
    const base = baseURL || "https://platform.hanzo.ai";

    const res = await request.get(`${base}/v1/o11y/metrics`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("success");
    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data.metrics)).toBe(true);
  });

  test("GET /v1/o11y/services/list returns registered services", async ({ request, baseURL }) => {
    test.skip(!token, "Requires authenticated Hanzo session token");
    const base = baseURL || "https://platform.hanzo.ai";

    const res = await request.get(`${base}/v1/o11y/services/list`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test("GET /v1/o11y/logs returns structured log stream container", async ({ request, baseURL }) => {
    test.skip(!token, "Requires authenticated Hanzo session token");
    const base = baseURL || "https://platform.hanzo.ai";

    const res = await request.get(`${base}/v1/o11y/logs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body).toBeDefined();
    expect(Array.isArray(body.results)).toBe(true);
  });

  test("GET /v1/o11y/alerts returns alerting engine status", async ({ request, baseURL }) => {
    test.skip(!token, "Requires authenticated Hanzo session token");
    const base = baseURL || "https://platform.hanzo.ai";

    const res = await request.get(`${base}/v1/o11y/alerts`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("success");
  });

  test("GET /v1/agent/activity returns agent invocations stream for this org", async ({ request, baseURL }) => {
    test.skip(!token, "Requires authenticated Hanzo session token");
    const base = baseURL || "https://platform.hanzo.ai";

    const res = await request.get(`${base}/v1/agent/activity`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.activity)).toBe(true);
    if (body.activity.length > 0) {
      const first = body.activity[0];
      expect(first.id).toBeTruthy();
      expect(first.kind).toBeTruthy();
      expect(first.agent).toBeTruthy();
      expect(first.at).toBeTruthy();
    }
  });

  test("GET /v1/agent/metrics returns 30D timeseries telemetry for active agents", async ({ request, baseURL }) => {
    test.skip(!token, "Requires authenticated Hanzo session token");
    const base = baseURL || "https://platform.hanzo.ai";

    const res = await request.get(`${base}/v1/agent/metrics`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.range).toBe("30D");
    expect(Array.isArray(body.series)).toBe(true);
  });

  test("GET /v1/agent/builds returns build queue for agentic workloads", async ({ request, baseURL }) => {
    test.skip(!token, "Requires authenticated Hanzo session token");
    const base = baseURL || "https://platform.hanzo.ai";

    const res = await request.get(`${base}/v1/agent/builds`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.builds)).toBe(true);
  });

  test("GET /v1/tool/catalog returns agent tool catalog with pagination", async ({ request, baseURL }) => {
    test.skip(!token, "Requires authenticated Hanzo session token");
    const base = baseURL || "https://platform.hanzo.ai";

    const res = await request.get(`${base}/v1/tool/catalog`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.catalog)).toBe(true);
    expect(typeof body.total).toBe("number");
    expect(typeof body.limit).toBe("number");
    expect(typeof body.offset).toBe("number");
  });

  test("GET /v1/prompt/catalog returns prompt engineering templates", async ({ request, baseURL }) => {
    test.skip(!token, "Requires authenticated Hanzo session token");
    const base = baseURL || "https://platform.hanzo.ai";

    const res = await request.get(`${base}/v1/prompt/catalog`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0].name).toBeTruthy();
    expect(body.data[0].prompt).toBeTruthy();
  });

  test("GET /v1/prompt/metrics returns prompt performance telemetry", async ({ request, baseURL }) => {
    test.skip(!token, "Requires authenticated Hanzo session token");
    const base = baseURL || "https://platform.hanzo.ai";

    const res = await request.get(`${base}/v1/prompt/metrics`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
  });

  test("GET /v1/projects confirms webby-ai & intel-hub telemetry bindings", async ({ request, baseURL }) => {
    test.skip(!token, "Requires authenticated Hanzo session token");
    const base = baseURL || "https://platform.hanzo.ai";

    const res = await request.get(`${base}/v1/projects`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    const projects: Array<{
      slug: string;
      status: string;
      liveUrl: string;
      analytics?: boolean;
      currentDeploymentId?: string;
      key?: string;
    }> = await res.json();

    const webby = projects.find((p) => p.slug === "webby-ai");
    expect(webby).toBeDefined();
    expect(webby?.status).toBe("live");
    expect(webby?.liveUrl).toBe("https://webby-ai.hanzo.app");
    expect(webby?.analytics).toBe(true);
    expect(webby?.key).toMatch(/^pk-/);

    const intel = projects.find((p) => p.slug === "intel-hub");
    expect(intel).toBeDefined();
    expect(intel?.status).toBe("live");
    expect(intel?.liveUrl).toBe("https://intel-hub.hanzo.app");
    expect(intel?.analytics).toBe(true);
    expect(intel?.key).toMatch(/^pk-/);
  });
});
