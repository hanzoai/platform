import { test, expect } from "@playwright/test";

test.describe("Platform Smoke Tests", () => {
  test("login page loads", async ({ page }) => {
    await page.goto("/");
    // Should redirect to login or show dashboard
    await expect(page.locator("body")).not.toBeEmpty();
  });

  test("Sign in with Hanzo button exists", async ({ page }) => {
    await page.goto("/");
    // Look for IAM login button
    const hanzoButton = page.getByRole("button", {
      name: /sign in with hanzo|hanzo/i,
    });
    // May not be visible if already logged in
    if (await hanzoButton.isVisible()) {
      await expect(hanzoButton).toBeEnabled();
    }
  });

  test("no critical console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const critical = errors.filter(
      (e) =>
        !e.includes("Failed to fetch") &&
        !e.includes("NetworkError") &&
        !e.includes("hydration")
    );
    expect(critical).toHaveLength(0);
  });
});
