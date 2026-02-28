import "@/styles/globals.css";

import dynamic from "next/dynamic";
import type { NextPage } from "next";
import type { AppProps } from "next/app";
import { Inter } from "next/font/google";
import Head from "next/head";
import Script from "next/script";
import { appWithTranslation } from "next-i18next";
import { ThemeProvider } from "next-themes";
import type { ReactElement, ReactNode } from "react";
import { Languages } from "@/lib/languages";
import { api } from "@/utils/api";

// Dynamic imports with SSR disabled to avoid context issues during build
const SearchCommand = dynamic(
	() => import("@/components/dashboard/search-command").then(m => m.SearchCommand),
	{ ssr: false }
);
const Toaster = dynamic(
	() => import("@/components/ui/sonner").then(m => m.Toaster),
	{ ssr: false }
);

const inter = Inter({ subsets: ["latin"] });

export type NextPageWithLayout<P = {}, IP = P> = NextPage<P, IP> & {
	getLayout?: (page: ReactElement) => ReactNode;
	theme?: string;
};

type AppPropsWithLayout = AppProps & {
	Component: NextPageWithLayout;
};

const MyApp = ({
	Component,
	pageProps: { ...pageProps },
}: AppPropsWithLayout) => {
	const getLayout = Component.getLayout ?? ((page) => page);

	return (
		<>
			<style jsx global>
				{`
					:root {
						--font-inter: ${inter.style.fontFamily};
					}
				`}
			</style>
			<Head>
				<title>Hanzo</title>
			</Head>
			{(process.env.NEXT_PUBLIC_HANZO_ANALYTICS_SITE_ID || process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID) && (
				<Script
					src={`${process.env.NEXT_PUBLIC_HANZO_ANALYTICS_URL || process.env.NEXT_PUBLIC_UMAMI_HOST || "https://analytics.hanzo.ai"}/script.js`}
					data-website-id={process.env.NEXT_PUBLIC_HANZO_ANALYTICS_SITE_ID || process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID}
					defer
				/>
			)}
			{process.env.NEXT_PUBLIC_POSTHOG_KEY && (
				<Script
					id="posthog-init"
					strategy="afterInteractive"
					dangerouslySetInnerHTML={{
						__html: `!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+" (stub)"},o="capture identify alias reset opt_in_capturing opt_out_capturing has_opted_out_capturing has_opted_in_capturing register register_once unregister".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||(window.posthog=[]));posthog.init('${process.env.NEXT_PUBLIC_POSTHOG_KEY}',{api_host:'${process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://insights.hanzo.ai"}',person_profiles:'identified_only'});`,
					}}
				/>
			)}

			<ThemeProvider
				attribute="class"
				defaultTheme="system"
				enableSystem
				disableTransitionOnChange
				forcedTheme={Component.theme}
			>
				<Toaster richColors />
				<SearchCommand />
				{getLayout(<Component {...pageProps} />)}
			</ThemeProvider>
		</>
	);
};

export default api.withTRPC(
	appWithTranslation(MyApp, {
		i18n: {
			defaultLocale: "en",
			locales: Object.values(Languages).map((language) => language.code),
			localeDetection: false,
		},
		fallbackLng: "en",
		keySeparator: false,
	}),
);
