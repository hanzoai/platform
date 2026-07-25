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

/** The ONE Hanzo Cloud telemetry front door — POST api.hanzo.ai/v1/event. Cloud
 *  fans the one batched stream out to the web (analytics.hanzo.ai), product
 *  (insights.hanzo.ai), and error (sentry.hanzo.ai) lenses; the client never sends
 *  the org — Cloud resolves the tenant server-side from the publishable ingest key
 *  (cross-origin) or a validated session. Platform is cross-origin to this edge, so
 *  a same-origin cookie cannot ride — the publishable key IS the auth. */
const HOST = "https://api.hanzo.ai";

/** Publishable ingest key (pk_…) minted per org via POST /v1/ingest/keys. It is a
 *  write-only, bundle-safe client key (never a secret hk-/sk-): it rides
 *  Authorization: Bearer pk_… on fetch and ?ingest_key=pk_… on unload beacons, so
 *  ALL THREE lenses (web + product + error) accept platform's cross-origin events
 *  with no cookie/bearer. Unset → events are best-effort anonymous (dropped at the
 *  edge when no tenant is resolvable), so this is REQUIRED for platform to emit. */
const INGEST_KEY = process.env.NEXT_PUBLIC_EVENT_INGEST_KEY?.trim() || undefined;

/** Honor an explicit browser opt-out (Global Privacy Control, then legacy DNT).
 *  SSR (no navigator) defaults to enabled; the browser reads the real signal. A
 *  visitor who opts out is not tracked at all — the client's `enabled` gate
 *  suppresses pageviews, events, AND errors. */
function consented(): boolean {
	if (typeof navigator === "undefined") return true;
	const nav = navigator as Navigator & {
		globalPrivacyControl?: boolean;
		doNotTrack?: string | null;
	};
	if (nav.globalPrivacyControl === true) return false;
	const dnt = nav.doNotTrack;
	return dnt !== "1" && dnt !== "yes";
}

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
 * @hanzo/event client → the ONE batched stream to api.hanzo.ai/v1/event, which
 * Cloud lenses into web analytics, product insights, AND error tracking (sentry).
 * It emits pageviews, a stable-id identify() once the better-auth session
 * resolves, AND captures render + global errors (auto: window.onerror +
 * unhandledrejection, on by default; React: the ErrorBoundary below) — subsuming
 * @sentry, no separate DSN. One client, one stream — errors are just events.
 * The publishable ingest key authenticates platform's cross-origin events to the
 * org; identify() then stamps the signed-in user. A Do-Not-Track visitor is
 * opted out entirely. Additive telemetry: worst case it no-ops.
 */
export function AnalyticsRoot({ children }: { children: ReactNode }) {
	const client = useMemo(
		() =>
			createAnalytics({
				product: "platform",
				host: HOST,
				ingestKey: INGEST_KEY,
				// Consent gate: honor the browser Do-Not-Track / GPC signal.
				enabled: consented(),
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
