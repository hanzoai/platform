import type { LanguageCode } from "@/lib/languages";
import Cookies from "js-cookie";

export default function useLocale() {
	const currentLocale = (Cookies.get("HANZO_LOCALE") ?? "en") as LanguageCode;

	const setLocale = (locale: LanguageCode) => {
		Cookies.set("HANZO_LOCALE", locale, { expires: 365 });
		window.location.reload();
	};

	return {
		locale: currentLocale,
		setLocale,
	};
}
