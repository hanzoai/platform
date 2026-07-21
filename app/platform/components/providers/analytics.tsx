import { useEffect, useMemo, type ReactNode } from "react";
import { useRouter } from "next/router";
import { createAnalytics } from "@hanzo/event";
import {
	AnalyticsProvider,
	ErrorBoundary,
	useAnalytics,
	usePageview,
} from "@hanzo/event/react";
import { authClient } from "@/lib/auth-client";

/** Cloud analytics ingest — api.hanzo.ai fronts /v1/analytics (+ /v1/tracker). */
const HOST = "https://api.hanzo.ai";

function Pageview() {
	// Pages-router path (updates on every navigation → one pageview per route).
	const { asPath } = useRouter();
	usePageview(asPath);
	return null;
}

function Identity() {
	const { data: session } = authClient.useSession();
	const analytics = useAnalytics();
	// Stable better-auth user id, never email/PII.
	const id = session?.user?.id;
	useEffect(() => {
		if (id) analytics.identify(id);
	}, [id, analytics]);
	return null;
}

/**
 * Telemetry root for the platform control plane. Wraps the app in the ONE shared
 * @hanzo/event client → emits pageviews, a stable-id identify() once the
 * better-auth session resolves, AND captures render + global errors (auto:
 * window.onerror + unhandledrejection; React: the ErrorBoundary below). One
 * client, one stream — errors are just events. Additive telemetry: worst case it
 * no-ops. Platform is a cookie/same-origin console, so there is no client-side
 * IAM bearer to bind — events ride anonymous until identify() stamps the user.
 */
export function AnalyticsRoot({ children }: { children: ReactNode }) {
	const client = useMemo(
		() =>
			createAnalytics({
				product: "platform",
				host: HOST,
			}),
		[],
	);

	return (
		<AnalyticsProvider client={client}>
			<ErrorBoundary>
				<Pageview />
				<Identity />
				{children}
			</ErrorBoundary>
		</AnalyticsProvider>
	);
}
