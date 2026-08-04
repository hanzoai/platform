import "@/styles/globals.css";

import type { NextPage } from "next";
import type { AppProps } from "next/app";
import { Geist, Geist_Mono } from "next/font/google";
import Head from "next/head";
import { ThemeProvider } from "next-themes";
import NextTopLoader from "nextjs-toploader";
import type { ReactElement, ReactNode } from "react";
import { SearchCommand } from "@/components/dashboard/search-command";
import { WhitelabelingProvider } from "@/components/dashboard/settings/whitelabeling/whitelabeling-provider";
import { AnalyticsRoot } from "@/components/providers/analytics";
import { Toaster } from "@/components/ui/sonner";
import { api } from "@/utils/api";

const geistSans = Geist({
	subsets: ["latin"],
	variable: "--font-geist",
});
const geistMono = Geist_Mono({
	subsets: ["latin"],
	variable: "--font-geist-mono",
});

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
		<div className={`${geistSans.variable} ${geistMono.variable} font-sans`}>
			<Head>
				<title>Hanzo Platform</title>
			</Head>
			<ThemeProvider
				attribute="class"
				defaultTheme="system"
				enableSystem
				disableTransitionOnChange
				forcedTheme={Component.theme}
			>
				<AnalyticsRoot>
					<NextTopLoader color="hsl(var(--sidebar-ring))" />
					<Toaster richColors />
					<SearchCommand />
					{getLayout(<Component {...pageProps} />)}
				</AnalyticsRoot>
			</ThemeProvider>
		</div>
	);
};

export default api.withTRPC(MyApp);
