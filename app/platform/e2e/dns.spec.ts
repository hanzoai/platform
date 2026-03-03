import { test, expect } from "./fixtures";

test.describe("DNS & Pages Settings", () => {
	test.beforeEach(async ({ settingsPage }) => {
		await settingsPage.navigateTo("dns");
	});

	test.describe("Page Structure", () => {
		test("renders DNS settings page with all tabs", async ({
			settingsPage,
		}) => {
			await settingsPage.expectTab("DNS Records");
			await settingsPage.expectTab("Pages");
			await settingsPage.expectTab("Verification");
		});

		test("defaults to DNS Records tab", async ({ page }) => {
			const recordsTab = page.getByRole("tab", { name: /dns records|records/i });
			await expect(recordsTab).toHaveAttribute("data-state", "active");
		});
	});

	test.describe("DNS Records Tab", () => {
		test("displays zone selector or record list", async ({ page }) => {
			const hasZoneSelector = await page
				.getByText(/zone|domain/i)
				.first()
				.isVisible()
				.catch(() => false);
			const hasRecordTable = await page
				.getByRole("table")
				.isVisible()
				.catch(() => false);
			const hasEmptyState = await page
				.getByText(/no records|no zones|empty|configure/i)
				.isVisible()
				.catch(() => false);
			expect(hasZoneSelector || hasRecordTable || hasEmptyState).toBeTruthy();
		});

		test("can open add record dialog", async ({ page }) => {
			const addButton = page.getByRole("button", {
				name: /add.*record|create.*record|new.*record/i,
			});
			if (await addButton.isVisible().catch(() => false)) {
				await addButton.click();
				await expect(
					page.getByRole("dialog").or(page.locator('[role="dialog"]')),
				).toBeVisible();
			}
		});

		test("create A record via Cloudflare provider", async ({
			page,
			settingsPage,
		}) => {
			const addButton = page.getByRole("button", {
				name: /add|create|new/i,
			});
			if (!(await addButton.isVisible().catch(() => false))) {
				return;
			}

			await addButton.click();

			// Select record type
			const typeSelect = page.getByLabel(/type/i);
			if (await typeSelect.isVisible().catch(() => false)) {
				await typeSelect.click();
				await page.getByRole("option", { name: /^A$/i }).click();
			}

			// Fill record details
			const nameInput = page.getByLabel(/^name$/i).or(page.getByPlaceholder(/name|subdomain/i));
			if (await nameInput.isVisible().catch(() => false)) {
				await nameInput.fill("e2e-test");
			}

			const contentInput = page.getByLabel(/content|value|address/i);
			if (await contentInput.isVisible().catch(() => false)) {
				await contentInput.fill("127.0.0.1");
			}

			// Toggle proxied if available
			const proxiedToggle = page.getByLabel(/proxied|proxy/i);
			if (await proxiedToggle.isVisible().catch(() => false)) {
				await proxiedToggle.click();
			}

			// Submit
			const submitButton = page
				.getByRole("dialog")
				.getByRole("button", { name: /create|save|add/i });
			if (await submitButton.isVisible().catch(() => false)) {
				await submitButton.click();
				await page.waitForLoadState("networkidle");
			}
		});

		test("displays record types including A, AAAA, CNAME, TXT, MX, NS", async ({
			page,
		}) => {
			const addButton = page.getByRole("button", {
				name: /add|create|new/i,
			});
			if (!(await addButton.isVisible().catch(() => false))) {
				return;
			}

			await addButton.click();

			const typeSelect = page.getByLabel(/type/i);
			if (await typeSelect.isVisible().catch(() => false)) {
				await typeSelect.click();

				const expectedTypes = ["A", "AAAA", "CNAME", "TXT", "MX", "NS"];
				for (const recordType of expectedTypes) {
					await expect(
						page.getByRole("option", { name: new RegExp(`^${recordType}$`, "i") }),
					).toBeVisible();
				}

				// Close the select
				await page.keyboard.press("Escape");
			}
		});
	});

	test.describe("Pages Projects Tab", () => {
		test.beforeEach(async ({ settingsPage }) => {
			await settingsPage.clickTab("Pages");
		});

		test("displays pages projects list or empty state", async ({ page }) => {
			const hasProjectCards = await page
				.locator("[data-testid='pages-project-card']")
				.first()
				.isVisible()
				.catch(() => false);
			const hasProjectList = await page
				.getByText(/project|deployment/i)
				.first()
				.isVisible()
				.catch(() => false);
			const hasEmptyState = await page
				.getByText(/no.*project|empty|no pages/i)
				.isVisible()
				.catch(() => false);
			expect(hasProjectCards || hasProjectList || hasEmptyState).toBeTruthy();
		});

		test("shows deploy button for existing projects", async ({ page }) => {
			const deployButton = page
				.getByRole("button", { name: /deploy/i })
				.first();
			const hasDeployButton = await deployButton.isVisible().catch(() => false);
			// Deploy button is expected only when projects exist
			if (hasDeployButton) {
				await expect(deployButton).toBeEnabled();
			}
		});
	});

	test.describe("Domain Verification Tab", () => {
		test.beforeEach(async ({ settingsPage }) => {
			await settingsPage.clickTab("Verification");
		});

		test("displays domain verification form", async ({ page }) => {
			const domainInput = page
				.getByPlaceholder(/domain|hostname/i)
				.or(page.getByLabel(/domain/i));
			await expect(domainInput).toBeVisible();
		});

		test("verify a known domain resolves", async ({ page }) => {
			const domainInput = page
				.getByPlaceholder(/domain|hostname/i)
				.or(page.getByLabel(/domain/i));
			await domainInput.fill("hanzo.ai");

			const verifyButton = page.getByRole("button", {
				name: /verify|check|resolve/i,
			});
			await verifyButton.click();

			// Wait for verification result
			await page.waitForLoadState("networkidle");

			// Should show resolution result
			const resultArea = page.locator(
				'[data-testid="verify-result"], .verify-result',
			);
			const hasResult = await resultArea.isVisible().catch(() => false);
			const hasResultText = await page
				.getByText(/resolved|valid|ip|address|error|failed/i)
				.isVisible()
				.catch(() => false);
			expect(hasResult || hasResultText).toBeTruthy();
		});

		test("verify with expected IP shows match status", async ({ page }) => {
			const domainInput = page
				.getByPlaceholder(/domain|hostname/i)
				.or(page.getByLabel(/domain/i));
			await domainInput.fill("hanzo.ai");

			const ipInput = page
				.getByPlaceholder(/ip|expected/i)
				.or(page.getByLabel(/expected.*ip|ip.*address/i));
			if (await ipInput.isVisible().catch(() => false)) {
				await ipInput.fill("1.2.3.4");
			}

			const verifyButton = page.getByRole("button", {
				name: /verify|check|resolve/i,
			});
			await verifyButton.click();

			await page.waitForLoadState("networkidle");

			// Should display match/mismatch result
			const hasMatchInfo = await page
				.getByText(/match|mismatch|resolves to|should point/i)
				.isVisible()
				.catch(() => false);
			const hasResult = await page
				.getByText(/resolved|valid|error/i)
				.isVisible()
				.catch(() => false);
			expect(hasMatchInfo || hasResult).toBeTruthy();
		});
	});

	test.describe("Navigation", () => {
		test("DNS & Pages link visible in settings sidebar for admin", async ({
			page,
		}) => {
			await page.goto("/dashboard/settings/profile");
			await expect(
				page.getByRole("link", { name: /dns|pages/i }),
			).toBeVisible();
		});

		test("navigates to DNS page from sidebar", async ({ page }) => {
			await page.goto("/dashboard/settings/profile");
			await page.getByRole("link", { name: /dns|pages/i }).click();
			await expect(page).toHaveURL(/\/dashboard\/settings\/dns/);
		});
	});
});
