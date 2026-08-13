// @hanzo/ui's compiled stylesheet, FIRST and by name.
//
// `<Hanzo>` imports it too, but from deeper in the module graph, so its rules
// landed after this app's and its design tokens won. That is not a cosmetic
// ordering detail: @hanzo/ui declares `--primary`, `--background`, `--border`
// and friends as finished colours (`#fafafa`), while this app's Tailwind config
// reads the SAME names as bare `H S% L%` triplets and wraps them —
// `hsl(var(--primary))`. Given a hex, that function is invalid, so every
// `bg-primary` / `bg-secondary` / `bg-destructive` in the app resolved to
// nothing and buttons rendered as bare text. Measured, not theorised.
//
// Importing it here puts the library's defaults where defaults belong: first,
// where the app's own tokens can override them. gui's own namespace (`--t_*`)
// is untouched either way, so components keep their scale.
import "@hanzo/ui/styles.css";
import "@/styles/globals.css";

import type { NextPage } from "next";
import type { AppProps } from "next/app";
import { Geist, Geist_Mono } from "next/font/google";
import Head from "next/head";
import { ThemeProvider } from "next-themes";
import NextTopLoader from "nextjs-toploader";
import type { ReactElement, ReactNode } from "react";
import { SearchCommand } from "@/components/dashboard/search-command";
import { WhitelabelingProvider } from "@/components/enterprise/whitelabeling/whitelabeling-provider";
import { AnalyticsRoot } from "@/components/providers/analytics";
import { GuiProvider } from "@/components/providers/gui";
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
			{/*
			  * Dark, because dark is the only palette this app HAS: globals.css
			  * declares `:root` and `.dark` as the same ramp, differing in seven
			  * incidental values, so "light" has never lightened the platform.
			  *
			  * Saying `light` out loud now costs something it did not before.
			  * @hanzo/ui's stylesheet honours a plain `.light` class — the same
			  * convention next-themes writes — and hangs 53 of its own tokens off
			  * it, including the `--text-primary` its base layer paints every bare
			  * h1–h4 with. On this app's permanently dark background that turned
			  * every heading into dark text on black. Measured on a light client.
			  *
			  * A page may still force its own theme. When the platform grows a
			  * real light ramp, this goes back to `system`.
			  */}
			<ThemeProvider
				attribute="class"
				defaultTheme="dark"
				disableTransitionOnChange
				forcedTheme={Component.theme ?? "dark"}
			>
				<GuiProvider>
					<AnalyticsRoot>
						<NextTopLoader color="hsl(var(--sidebar-ring))" />
						<Toaster richColors />
						<SearchCommand />
						{getLayout(<Component {...pageProps} />)}
					</AnalyticsRoot>
				</GuiProvider>
			</ThemeProvider>
		</div>
	);
};

export default api.withTRPC(MyApp);
