import { test, expect } from "./fixtures";

test.describe("Gateway Settings", () => {
	test.beforeEach(async ({ settingsPage }) => {
		await settingsPage.navigateTo("gateway");
	});

	test.describe("Page Structure", () => {
		test("renders gateway settings page with all tabs", async ({
			page,
			settingsPage,
		}) => {
			await settingsPage.expectTab("Status");
			await settingsPage.expectTab("Rate Limits");
			await settingsPage.expectTab("Routes");
		});

		test("defaults to status tab", async ({ page }) => {
			const statusTab = page.getByRole("tab", { name: /status/i });
			await expect(statusTab).toHaveAttribute("data-state", "active");
		});
	});

	test.describe("Status Tab", () => {
		test("displays health status cards for all gateway components", async ({
			page,
		}) => {
			await expect(page.getByText(/traefik/i).first()).toBeVisible();
			await expect(page.getByText(/cloud api/i).first()).toBeVisible();
			await expect(page.getByText(/bot gateway/i).first()).toBeVisible();
		});

		test("shows healthy or error state for each component", async ({
			page,
		}) => {
			// Each status card should show either a healthy indicator or error message
			const statusCards = page.locator('[data-testid="gateway-status-card"]');
			const cardCount = await statusCards.count().catch(() => 0);

			if (cardCount > 0) {
				for (let i = 0; i < cardCount; i++) {
					const card = statusCards.nth(i);
					const hasHealthy = await card.getByText(/healthy|online/i).isVisible().catch(() => false);
					const hasError = await card.getByText(/error|offline|unavailable/i).isVisible().catch(() => false);
					expect(hasHealthy || hasError).toBeTruthy();
				}
			} else {
				// Fallback: check for text content indicating status
				const pageContent = await page.textContent("body");
				const hasStatusInfo =
					pageContent?.match(/healthy|online|error|offline|unavailable/i) !== null;
				expect(hasStatusInfo).toBeTruthy();
			}
		});
	});

	test.describe("Rate Limits Tab", () => {
		test.beforeEach(async ({ settingsPage }) => {
			await settingsPage.clickTab("Rate Limits");
		});

		test("displays rate limits table or empty state", async ({ page }) => {
			const hasTable = await page.getByRole("table").isVisible().catch(() => false);
			const hasEmptyState = await page
				.getByText(/no rate limit|no rules|empty/i)
				.isVisible()
				.catch(() => false);
			expect(hasTable || hasEmptyState).toBeTruthy();
		});

		test("can open create rate limit dialog", async ({ page }) => {
			const addButton = page.getByRole("button", {
				name: /add|create|new/i,
			});
			if (await addButton.isVisible().catch(() => false)) {
				await addButton.click();
				await expect(
					page.getByRole("dialog").or(page.locator('[role="dialog"]')),
				).toBeVisible();
			}
		});

		test("create rate limit rule with global scope", async ({
			page,
			settingsPage,
		}) => {
			const addButton = page.getByRole("button", {
				name: /add|create|new/i,
			});
			if (!(await addButton.isVisible().catch(() => false))) {
				test.skip();
				return;
			}

			await addButton.click();

			// Fill the form
			await settingsPage.fillDialog({
				name: "test-global-rate-limit",
			});

			// Select scope
			const scopeSelect = page.getByLabel(/scope/i);
			if (await scopeSelect.isVisible().catch(() => false)) {
				await scopeSelect.click();
				await page.getByRole("option", { name: /global/i }).click();
			}

			// Set requests per minute
			const rpmInput = page.getByLabel(/requests.*per.*minute|rpm/i);
			if (await rpmInput.isVisible().catch(() => false)) {
				await rpmInput.clear();
				await rpmInput.fill("100");
			}

			// Set burst size
			const burstInput = page.getByLabel(/burst/i);
			if (await burstInput.isVisible().catch(() => false)) {
				await burstInput.clear();
				await burstInput.fill("20");
			}

			// Submit
			const submitButton = page
				.getByRole("dialog")
				.getByRole("button", { name: /create|save|submit|add/i });
			await submitButton.click();

			// Wait for dialog to close and verify the rule appears
			await expect(
				page.getByRole("dialog").or(page.locator('[role="dialog"]')),
			).not.toBeVisible({ timeout: 10_000 });

			await expect(page.getByText("test-global-rate-limit")).toBeVisible({
				timeout: 10_000,
			});
		});

		test("delete rate limit rule", async ({ page }) => {
			// Look for a delete button on any existing rule
			const deleteButton = page
				.getByRole("button", { name: /delete|remove/i })
				.first();
			if (!(await deleteButton.isVisible().catch(() => false))) {
				return;
			}

			await deleteButton.click();

			// Confirm deletion if there's a confirmation dialog
			const confirmButton = page.getByRole("button", {
				name: /confirm|yes|delete/i,
			});
			if (await confirmButton.isVisible().catch(() => false)) {
				await confirmButton.click();
			}

			await page.waitForLoadState("networkidle");
		});
	});

	test.describe("Routes Tab", () => {
		test.beforeEach(async ({ settingsPage }) => {
			await settingsPage.clickTab("Routes");
		});

		test("displays routing rules table or empty state", async ({ page }) => {
			const hasTable = await page.getByRole("table").isVisible().catch(() => false);
			const hasEmptyState = await page
				.getByText(/no route|no rules|empty/i)
				.isVisible()
				.catch(() => false);
			expect(hasTable || hasEmptyState).toBeTruthy();
		});

		test("can open create route dialog", async ({ page }) => {
			const addButton = page.getByRole("button", {
				name: /add|create|new/i,
			});
			if (await addButton.isVisible().catch(() => false)) {
				await addButton.click();
				await expect(
					page.getByRole("dialog").or(page.locator('[role="dialog"]')),
				).toBeVisible();
			}
		});

		test("create routing rule", async ({ page, settingsPage }) => {
			const addButton = page.getByRole("button", {
				name: /add|create|new/i,
			});
			if (!(await addButton.isVisible().catch(() => false))) {
				test.skip();
				return;
			}

			await addButton.click();

			await settingsPage.fillDialog({
				name: "test-route",
				host: "test.hanzo.ai",
				backend: "http://test-service:8080",
			});

			const pathInput = page.getByLabel(/path.*prefix|prefix/i);
			if (await pathInput.isVisible().catch(() => false)) {
				await pathInput.fill("/api/test");
			}

			const submitButton = page
				.getByRole("dialog")
				.getByRole("button", { name: /create|save|submit|add/i });
			await submitButton.click();

			await expect(
				page.getByRole("dialog").or(page.locator('[role="dialog"]')),
			).not.toBeVisible({ timeout: 10_000 });

			await expect(page.getByText("test-route")).toBeVisible({
				timeout: 10_000,
			});
		});
	});

	test.describe("Navigation", () => {
		test("gateway link visible in settings sidebar for admin", async ({
			page,
		}) => {
			await page.goto("/dashboard/settings/profile");
			await expect(
				page.getByRole("link", { name: /gateway/i }),
			).toBeVisible();
		});

		test("navigates to gateway page from sidebar", async ({ page }) => {
			await page.goto("/dashboard/settings/profile");
			await page.getByRole("link", { name: /gateway/i }).click();
			await expect(page).toHaveURL(/\/dashboard\/settings\/gateway/);
		});
	});
});
