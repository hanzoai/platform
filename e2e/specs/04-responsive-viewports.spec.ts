import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

/**
 * Responsive Viewports & Visual Evidence E2E Tests
 * Validates self-service presentation across:
 * - Desktop 1080p (1920x1080)
 * - Laptop 768p (1366x768)
 * - Tablet iPad (768x1024)
 * - Mobile iPhone (390x844)
 *
 * Enforces:
 * - Zero horizontal clipping (scrollWidth <= clientWidth)
 * - Visible, touch-friendly interactive targets
 * - Saves high-fidelity visual evidence to artifacts directory
 */

const SCREENSHOT_DIR =
  "/Users/a/.gemini/antigravity-cli/brain/1e63da43-29f9-48ac-8bee-17ae7219de8f/screenshots";

test.beforeAll(() => {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }
});

const VIEWPORTS = [
  { name: "desktop-1080p", width: 1920, height: 1080, file: "platform-01-desktop-1080p-auth.png" },
  { name: "laptop-1366", width: 1366, height: 768, file: "platform-02-laptop-1366-auth.png" },
  { name: "tablet-ipad", width: 768, height: 1024, file: "platform-03-tablet-ipad-auth.png" },
  { name: "mobile-iphone", width: 390, height: 844, file: "platform-04-mobile-iphone-auth.png" },
];

test.describe("Responsive Viewports & Overflow Prevention", () => {
  for (const vp of VIEWPORTS) {
    test(`Auth gate displays cleanly on ${vp.name} (${vp.width}x${vp.height}) with zero horizontal overflow`, async ({
      page,
      baseURL,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(baseURL || "https://platform.hanzo.ai", { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForURL(/hanzo\.id/, { timeout: 25000 });

      // Check for zero horizontal overflow
      const overflow = await page.evaluate(() => {
        return {
          bodyScrollWidth: document.body.scrollWidth,
          bodyClientWidth: document.body.clientWidth,
          docScrollWidth: document.documentElement.scrollWidth,
          docClientWidth: document.documentElement.clientWidth,
        };
      });

      expect(
        overflow.docScrollWidth,
        `Viewport ${vp.name} document horizontal overflow detected (${overflow.docScrollWidth} > ${overflow.docClientWidth})`
      ).toBeLessThanOrEqual(overflow.docClientWidth + 1);

      // Verify submit button is in view
      const submitBtn = page.getByRole("button", { name: /^continue$/i });
      await expect(submitBtn).toBeVisible();

      // Capture screenshot artifact
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, vp.file),
        fullPage: false,
      });
    });
  }

  test("Mobile self-service registration (/signup) renders cleanly", async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(baseURL || "https://platform.hanzo.ai", { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForURL(/hanzo\.id/, { timeout: 25000 });

    await page.getByRole("link", { name: /create account/i }).click();
    await page.waitForURL(/\/signup/, { timeout: 15000 });
    await page.getByRole("button", { name: /create account/i }).waitFor({ state: "visible", timeout: 10000 });

    const overflow = await page.evaluate(() => {
      return {
        docScrollWidth: document.documentElement.scrollWidth,
        docClientWidth: document.documentElement.clientWidth,
      };
    });
    expect(overflow.docScrollWidth).toBeLessThanOrEqual(overflow.docClientWidth + 1);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "platform-05-mobile-signup.png"),
      fullPage: false,
    });
  });

  test("Mobile self-service account recovery (/forget) renders cleanly", async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(baseURL || "https://platform.hanzo.ai", { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForURL(/hanzo\.id/, { timeout: 25000 });

    await page.getByRole("link", { name: /forgot password\?/i }).click();
    await page.waitForURL(/\/forget/, { timeout: 15000 });
    await page.getByRole("button", { name: /send code/i }).waitFor({ state: "visible", timeout: 10000 });

    const overflow = await page.evaluate(() => {
      return {
        docScrollWidth: document.documentElement.scrollWidth,
        docClientWidth: document.documentElement.clientWidth,
      };
    });
    expect(overflow.docScrollWidth).toBeLessThanOrEqual(overflow.docClientWidth + 1);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "platform-06-mobile-forgot.png"),
      fullPage: false,
    });
  });

  test("Mobile passwordless login renders cleanly", async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(baseURL || "https://platform.hanzo.ai", { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForURL(/hanzo\.id/, { timeout: 25000 });

    await page.getByRole("button", { name: /send me a code instead/i }).click();
    await expect(page.getByRole("button", { name: /send a code/i })).toBeVisible();

    const overflow = await page.evaluate(() => {
      return {
        docScrollWidth: document.documentElement.scrollWidth,
        docClientWidth: document.documentElement.clientWidth,
      };
    });
    expect(overflow.docScrollWidth).toBeLessThanOrEqual(overflow.docClientWidth + 1);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "platform-07-mobile-passwordless.png"),
      fullPage: false,
    });
  });
});
