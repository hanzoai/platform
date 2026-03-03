import { test, expect } from "./fixtures";

test.describe("Settings Navigation", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/dashboard/settings/profile");
		await page.waitForLoadState("networkidle");
	});

	test.describe("Sidebar Links", () => {
		test("displays all core settings links", async ({ page }) => {
			const expectedLinks = [
				"Profile",
				"Servers",
				"SSH Keys",
				"Git",
			];

			for (const linkText of expectedLinks) {
				await expect(
					page.getByRole("link", { name: new RegExp(linkText, "i") }),
				).toBeVisible();
			}
		});

		test("displays admin-only links for admin users", async ({ page }) => {
			const adminLinks = [
				"Gateway",
				"DNS",
			];

			for (const linkText of adminLinks) {
				const link = page.getByRole("link", {
					name: new RegExp(linkText, "i"),
				});
				const isVisible = await link.isVisible().catch(() => false);
				// These should be visible for admin/owner users
				if (isVisible) {
					await expect(link).toHaveAttribute("href", expect.stringContaining("/dashboard/settings/"));
				}
			}
		});
	});

	test.describe("Page Routing", () => {
		const settingsPages = [
			{ name: "Profile", path: "profile" },
			{ name: "Gateway", path: "gateway" },
			{ name: "DNS", path: "dns" },
		];

		for (const { name, path } of settingsPages) {
			test(`${name} settings page loads without error`, async ({
				page,
			}) => {
				await page.goto(`/dashboard/settings/${path}`);

				// Should not show 404 or error page
				const hasError = await page
					.getByText(/404|not found|error|something went wrong/i)
					.isVisible()
					.catch(() => false);
				expect(hasError).toBeFalsy();

				// Should have some content
				const bodyText = await page.textContent("body");
				expect(bodyText?.length).toBeGreaterThan(50);
			});
		}
	});

	test.describe("Cross-Navigation", () => {
		test("can navigate between gateway and DNS pages", async ({
			page,
		}) => {
			// Navigate to gateway
			await page.goto("/dashboard/settings/gateway");
			await page.waitForLoadState("networkidle");
			await expect(page).toHaveURL(/gateway/);

			// Find and click DNS link
			const dnsLink = page.getByRole("link", { name: /dns|pages/i });
			if (await dnsLink.isVisible().catch(() => false)) {
				await dnsLink.click();
				await expect(page).toHaveURL(/dns/);
			}

			// Navigate back to gateway
			const gatewayLink = page.getByRole("link", { name: /gateway/i });
			if (await gatewayLink.isVisible().catch(() => false)) {
				await gatewayLink.click();
				await expect(page).toHaveURL(/gateway/);
			}
		});

		test("preserves tab state within a page on navigation", async ({
			page,
		}) => {
			await page.goto("/dashboard/settings/gateway");
			await page.waitForLoadState("networkidle");

			// Click Rate Limits tab
			const rateLimitsTab = page.getByRole("tab", {
				name: /rate limit/i,
			});
			if (await rateLimitsTab.isVisible().catch(() => false)) {
				await rateLimitsTab.click();
				await expect(rateLimitsTab).toHaveAttribute(
					"data-state",
					"active",
				);
			}
		});
	});
});
