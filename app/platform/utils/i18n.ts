import type { NextApiRequestCookies } from "next/dist/server/api-utils";

export function getLocale(cookies: NextApiRequestCookies) {
	const locale = cookies.PLATFORM_LOCALE ?? "en";
	return locale;
}

/**
 * Simplified serverSideTranslations stub.
 * Upstream removed next-i18next in favor of a simpler approach.
 * Returns empty props — pages that call this will still render.
 */
export const serverSideTranslations = async (
	_locale: string,
	_namespaces: string[] = ["common"],
) => ({});
