import { test, expect } from "./fixtures";

/**
 * Brand SMS/Email Provider Override
 *
 * Hits /dashboard/settings/notify-provider. Verifies the UI:
 *   - Renders the "currently using" badge (Liquidity default or brand override).
 *   - Has the four override form fields.
 *   - Has a Test button that reveals the test panel.
 *
 * Does NOT hit a live KMS — those flows are covered by the notify
 * Go tests in internal/tenant/plivo_resolver_test.go and the
 * integration tests against a real cluster.
 */

test.describe("Brand notify provider override", () => {
	test.beforeEach(async ({ settingsPage }) => {
		await settingsPage.navigateTo("notify-provider");
	});

	test("renders the override form", async ({ page }) => {
		await expect(
			page.getByTestId("brand-plivo-settings"),
		).toBeVisible({ timeout: 10_000 });

		// The four form fields exist.
		await expect(page.getByTestId("input-auth-id")).toBeVisible();
		await expect(page.getByTestId("input-auth-token")).toBeVisible();
		await expect(page.getByTestId("input-sender-id")).toBeVisible();
		await expect(page.getByTestId("input-from-email")).toBeVisible();

		// Save / Test buttons.
		await expect(page.getByTestId("btn-save")).toBeVisible();
		await expect(page.getByTestId("btn-show-test")).toBeVisible();
	});

	test("shows effective provider badge", async ({ page }) => {
		await expect(page.getByTestId("brand-plivo-settings")).toBeVisible({
			timeout: 10_000,
		});

		// Either Liquidity default or a brand override badge is visible —
		// both are acceptable initial states depending on which brand the
		// test user belongs to.
		const defaultBadge = page.getByTestId("badge-default");
		const overrideBadge = page.getByTestId("badge-override");

		const hasDefault = await defaultBadge.isVisible().catch(() => false);
		const hasOverride = await overrideBadge.isVisible().catch(() => false);
		expect(hasDefault || hasOverride).toBeTruthy();
	});

	test("toggles the test panel", async ({ page }) => {
		await expect(page.getByTestId("brand-plivo-settings")).toBeVisible({
			timeout: 10_000,
		});

		// Initially hidden.
		await expect(page.getByTestId("test-panel")).not.toBeVisible();

		// Click "Test" — panel opens.
		await page.getByTestId("btn-show-test").click();
		await expect(page.getByTestId("test-panel")).toBeVisible();

		// Recipient + channel select + send button visible.
		await expect(page.getByTestId("input-test-recipient")).toBeVisible();
		await expect(page.getByTestId("btn-send-test")).toBeVisible();

		// Click again — panel collapses.
		await page.getByTestId("btn-show-test").click();
		await expect(page.getByTestId("test-panel")).not.toBeVisible();
	});

	test("validates the auth fields before save", async ({ page }) => {
		await expect(page.getByTestId("brand-plivo-settings")).toBeVisible({
			timeout: 10_000,
		});

		// Submit empty.
		await page.getByTestId("btn-save").click();

		// Form-level required errors should appear (react-hook-form +
		// zodResolver). Check at least one is visible.
		const errors = await page
			.locator("[role='alert'], .text-destructive, .text-red-500")
			.count()
			.catch(() => 0);
		expect(errors).toBeGreaterThan(0);
	});

	test.describe("Screenshot", () => {
		test("captures the settings page", async ({ page }) => {
			await expect(page.getByTestId("brand-plivo-settings")).toBeVisible({
				timeout: 10_000,
			});
			await page.screenshot({
				path: "test-results/brand-notify-provider.png",
				fullPage: true,
			});
		});
	});
});
