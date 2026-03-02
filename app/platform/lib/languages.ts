export type LanguageCode = "en";

export const Languages = [
	{ code: "en" as const, name: "English" },
] as const;

export type Language = (typeof Languages)[number];
