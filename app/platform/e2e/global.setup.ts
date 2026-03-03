import { test as setup, expect } from "@playwright/test";
import path from "node:path";

const authFile = path.join(__dirname, ".auth/user.json");

setup("authenticate", async ({ page }) => {
	const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
	const email = process.env.PLAYWRIGHT_USER_EMAIL || "admin@hanzo.ai";
	const password = process.env.PLAYWRIGHT_USER_PASSWORD || "hanzo2026";

	await page.goto(`${baseURL}/`);

	// Wait for the login page to load
	await page.waitForURL(/\/(login|auth)/, { timeout: 15_000 }).catch(() => {
		// Already authenticated or different auth flow
	});

	// If redirected to login, authenticate
	if (page.url().includes("/login") || page.url().includes("/auth")) {
		await page.getByPlaceholder(/email/i).fill(email);
		await page.getByPlaceholder(/password/i).fill(password);
		await page.getByRole("button", { name: /sign in|log in|submit/i }).click();
		await page.waitForURL("**/dashboard/**", { timeout: 30_000 });
	}

	await expect(page).toHaveURL(/dashboard/);
	await page.context().storageState({ path: authFile });
});
