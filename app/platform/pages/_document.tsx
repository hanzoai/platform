import { Head, Html, Main, NextScript } from "next/document";

export default function Document() {
	return (
		<Html lang="en" className="font-sans">
			<Head>
				<link rel="icon" href="/icon.svg" />
				{/* Hanzo Analytics */}
				<script defer src="https://analytics.hanzo.ai/script.js" data-website-id="c8d2ce3a-8591-4f63-8920-b6ce0393dd1a" data-do-not-track="true" data-exclude-search="true" />
			</Head>
			<body className="flex h-full w-full flex-col font-sans">
				<Main />
				<NextScript />
			</body>
		</Html>
	);
}
