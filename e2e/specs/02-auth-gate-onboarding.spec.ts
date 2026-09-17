import { test, expect } from "@playwright/test";

/**
 * Customer Authentication, Onboarding & Self-Service Registration E2E Tests
 * Validates the complete customer entry point:
 * - Anonymous gateway redirect to Hanzo ID (OIDC PKCE)
 * - Sign-in options (Email/Password, Passwordless code, Social SSO, Web3 Wallet)
 * - Self-service account registration (/signup)
 * - Self-service account recovery (/forget)
 * - Compliance and legal links (Terms & Privacy)
 */

test.describe("Customer Auth Gate & Onboarding", () => {
  test("Anonymous visitor to platform root redirects to Hanzo ID OAuth PKCE flow", async ({ page, baseURL }) => {
    await page.goto(baseURL || "https://platform.hanzo.ai", { waitUntil: "domcontentloaded", timeout: 30000 });

    // Wait for client-side redirection to Hanzo ID
    await page.waitForURL(/hanzo\.id/, { timeout: 25000 });
    const currentUrl = page.url();

    expect(currentUrl).toMatch(/^https:\/\/hanzo\.id\/login\/oauth\/authorize\?/);

    const url = new URL(currentUrl);
    const params = url.searchParams;

    // Validate OIDC PKCE parameters
    expect(params.get("client_id")).toBeTruthy();
    expect(params.get("response_type")).toBe("code");
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("code_challenge")).toBeTruthy();
    expect(params.get("state")).toBeTruthy();
    expect(params.get("redirect_uri")).toContain("platform.hanzo.ai/auth/callback");
    expect(params.get("scope") || "").toContain("openid");
  });

  test("Sign-in gate renders all customer self-service login methods", async ({ page, baseURL }) => {
    await page.goto(baseURL || "https://platform.hanzo.ai", { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForURL(/hanzo\.id/, { timeout: 25000 });

    // Header & branding
    await expect(page.getByText("Hanzo ID")).toBeVisible();
    await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();

    // Credentials inputs
    const inputs = page.locator("input");
    expect(await inputs.count()).toBeGreaterThanOrEqual(2);

    // Primary submit button
    const submitBtn = page.getByRole("button", { name: /^continue$/i });
    await expect(submitBtn).toBeVisible();
    await expect(submitBtn).toBeEnabled();

    // SSO & Alternative auth buttons
    await expect(page.getByRole("button", { name: /continue with google/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /continue with github/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /continue with wallet/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /continue with phone/i })).toBeVisible();

    // Passwordless code toggle
    const codeToggle = page.getByRole("button", { name: /send me a code instead/i });
    await expect(codeToggle).toBeVisible();
    await codeToggle.click();

    // Verify transition to code input mode
    await expect(page.getByRole("button", { name: /use my password instead/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /send a code/i })).toBeVisible();

    // Switch back to password
    await page.getByRole("button", { name: /use my password instead/i }).click();
    await expect(page.getByRole("button", { name: /send me a code instead/i })).toBeVisible();
  });

  test("New customer can navigate to self-service registration (/signup)", async ({ page, baseURL }) => {
    await page.goto(baseURL || "https://platform.hanzo.ai", { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForURL(/hanzo\.id/, { timeout: 25000 });

    const createAccountLink = page.getByRole("link", { name: /create account/i });
    await expect(createAccountLink).toBeVisible();

    // Click to enter signup flow
    await createAccountLink.click();
    await page.waitForURL(/\/signup/, { timeout: 15000 });

    const signupUrl = new URL(page.url());
    expect(signupUrl.pathname).toBe("/signup");
    expect(signupUrl.searchParams.get("client_id")).toBeTruthy();
    expect(signupUrl.searchParams.get("redirect_uri")).toContain("platform.hanzo.ai/auth/callback");

    // Form elements on registration page
    await expect(page.getByText("Create your Hanzo account")).toBeVisible();
    await expect(page.getByRole("button", { name: /create account/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /sign up with google/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /sign up with github/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /sign up with wallet/i })).toBeVisible();

    // Back to sign in link
    const backToSignIn = page.getByRole("link", { name: /already have an account\? sign in|sign in/i });
    await expect(backToSignIn).toBeVisible();
    await backToSignIn.click();
    await page.waitForURL(/\/login|\/authorize/, { timeout: 15000 });
  });

  test("Customer can navigate to self-service password recovery (/forget)", async ({ page, baseURL }) => {
    await page.goto(baseURL || "https://platform.hanzo.ai", { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForURL(/hanzo\.id/, { timeout: 25000 });

    const forgotLink = page.getByRole("link", { name: /forgot password\?/i });
    await expect(forgotLink).toBeVisible();

    // Click to enter recovery flow
    await forgotLink.click();
    await page.waitForURL(/\/forget/, { timeout: 15000 });

    const forgetUrl = new URL(page.url());
    expect(forgetUrl.pathname).toBe("/forget");

    await expect(page.getByText("Get back into your Hanzo account")).toBeVisible();
    await expect(page.getByRole("button", { name: /send code/i })).toBeVisible();

    // Back to sign in link
    const backLink = page.getByRole("link", { name: /back to sign in/i });
    await expect(backLink).toBeVisible();
    await backLink.click();
    await page.waitForURL(/\/login|\/authorize/, { timeout: 15000 });
  });

  test("Compliance and legal links are active and correctly attributed", async ({ page, baseURL }) => {
    await page.goto(baseURL || "https://platform.hanzo.ai", { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForURL(/hanzo\.id/, { timeout: 25000 });

    const termsLink = page.getByRole("link", { name: /^terms$/i });
    await expect(termsLink).toBeVisible();
    expect(await termsLink.getAttribute("href")).toBe("https://hanzo.ai/terms");

    const privacyLink = page.getByRole("link", { name: /^privacy$/i });
    await expect(privacyLink).toBeVisible();
    expect(await privacyLink.getAttribute("href")).toBe("https://hanzo.ai/privacy");

    await expect(page.getByText(/Hanzo AI Inc/i)).toBeVisible();
  });

  test("Auth and onboarding flow executes without fatal console errors", async ({ page, baseURL }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await page.goto(baseURL || "https://platform.hanzo.ai", { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForURL(/hanzo\.id/, { timeout: 25000 });

    // Filter out expected third-party or network tracking warnings
    const fatalErrors = errors.filter(
      (e) =>
        !e.includes("Failed to fetch") &&
        !e.includes("NetworkError") &&
        !e.includes("favicon") &&
        !e.includes("analytics")
    );
    expect(fatalErrors).toHaveLength(0);
  });
});
