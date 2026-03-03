import { test as base, expect } from "@playwright/test";

interface SettingsFixtures {
	settingsPage: ReturnType<typeof createSettingsHelper>;
}

function createSettingsHelper(page: any) {
	return {
		async navigateTo(section: string) {
			await page.goto(`/dashboard/settings/${section}`);
			await page.waitForLoadState("networkidle");
		},
		async expectTab(tabName: string) {
			const tab = page.getByRole("tab", { name: new RegExp(tabName, "i") });
			await expect(tab).toBeVisible();
			return tab;
		},
		async clickTab(tabName: string) {
			const tab = page.getByRole("tab", { name: new RegExp(tabName, "i") });
			await tab.click();
			await page.waitForLoadState("networkidle");
		},
		async expectHeading(text: string) {
			await expect(
				page.getByRole("heading", { name: new RegExp(text, "i") }),
			).toBeVisible();
		},
		async fillDialog(fields: Record<string, string>) {
			for (const [label, value] of Object.entries(fields)) {
				const input = page.getByLabel(new RegExp(label, "i"));
				await input.clear();
				await input.fill(value);
			}
		},
	};
}

export const test = base.extend<SettingsFixtures>({
	settingsPage: async ({ page }, use) => {
		await use(createSettingsHelper(page));
	},
});

export { expect } from "@playwright/test";
