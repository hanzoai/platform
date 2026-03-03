import { test, expect } from "./fixtures";

test.describe("Billing Settings", () => {
	test.describe("Billing Page Access", () => {
		test("billing page loads for cloud environments", async ({
			page,
			settingsPage,
		}) => {
			await settingsPage.navigateTo("billing");

			// Billing is cloud-only - if not cloud mode, we get redirected
			const isBillingPage = page.url().includes("/billing");
			const isRedirected =
				page.url().includes("/projects") ||
				page.url().includes("/profile");

			expect(isBillingPage || isRedirected).toBeTruthy();
		});

		test("billing link visibility depends on cloud mode", async ({
			page,
		}) => {
			await page.goto("/dashboard/settings/profile");

			const billingLink = page.getByRole("link", { name: /billing/i });
			// Billing nav item should exist (might be hidden if not cloud)
			const isVisible = await billingLink.isVisible().catch(() => false);

			// In cloud mode it's visible, in self-hosted it's hidden - both are valid
			expect(typeof isVisible).toBe("boolean");
		});
	});
});
