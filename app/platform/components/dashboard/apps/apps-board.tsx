"use client";

import type { DriftSeverity } from "@hanzo/platform/db/schema";
import { ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
	AppHealth,
	AppSync,
	AppsSummary,
	AppView,
} from "@/server/apps/apps-api";

/**
 * The fleet board — every app of every org, in ONE view.
 *
 * Pure presentation over the `AppView[]` that `/v1/apps` returns: declared /
 * running / latest tag, the deployer's sync verdict, and the computed drift.
 * The org filter is a projection of these same rows, not a separate panel per
 * org — one implementation, so hanzo, lux and zoo can never disagree about what
 * a column means.
 *
 * BRAND: deliberately unbranded. No mark, no logo, no org colour — a Lux row
 * must never carry a Hanzo mark, and the way to guarantee that in a shared
 * table is to carry no mark at all. The org is a word in a column.
 *
 * HONESTY: a value the readers could not observe renders "unknown", never a
 * placeholder that reads like data. Every "unknown" on this board means "nobody
 * could see it", and that is itself information.
 */

const SEVERITY_BADGE: Record<DriftSeverity, "green" | "yellow" | "red"> = {
	ok: "green",
	yellow: "yellow",
	red: "red",
};

const HEALTH_BADGE: Record<AppHealth, "green" | "yellow" | "red"> = {
	green: "green",
	yellow: "yellow",
	red: "red",
};

/** The deployer's verdict, in the words its own users use. */
const SYNC_LABEL: Record<AppSync, string> = {
	synced: "synced",
	drifted: "out of sync",
	unknown: "unknown",
};

const SYNC_BADGE: Record<AppSync, "green" | "yellow" | "blank"> = {
	synced: "green",
	drifted: "yellow",
	unknown: "blank",
};

/** Every org present in the rows, most apps first, then alphabetical. */
export function orgsOf(apps: Pick<AppView, "org">[]): string[] {
	const counts = new Map<string, number>();
	for (const a of apps) counts.set(a.org, (counts.get(a.org) ?? 0) + 1);
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.map(([org]) => org);
}

/** Relative "2m ago" for the last-observed column; "never" when unobserved. */
function timeAgo(iso: string | null): string {
	if (!iso) return "never";
	const then = Date.parse(iso);
	if (Number.isNaN(then)) return "never";
	const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
	if (secs < 60) return `${secs}s ago`;
	const mins = Math.floor(secs / 60);
	if (mins < 60) return `${mins}m ago`;
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) return `${hrs}h ago`;
	return `${Math.floor(hrs / 24)}d ago`;
}

/** Unobserved is a fact, not a blank. */
function Unknown() {
	return <span className="text-muted-foreground text-xs">unknown</span>;
}

function TagCell({ tag }: { tag: string | null }) {
	if (!tag) return <Unknown />;
	return <span className="font-mono text-xs">{tag}</span>;
}

function SyncCell({ app }: { app: AppView }) {
	if (!app.syncStatus) {
		return (
			<TooltipProvider>
				<Tooltip>
					<TooltipTrigger asChild>
						<span className="text-muted-foreground text-xs">unmanaged</span>
					</TooltipTrigger>
					<TooltipContent>
						No CD Application delivers this app — nothing compares it to git.
					</TooltipContent>
				</Tooltip>
			</TooltipProvider>
		);
	}
	const badge = (
		<Badge variant={SYNC_BADGE[app.syncStatus]}>
			{SYNC_LABEL[app.syncStatus]}
		</Badge>
	);
	if (!app.syncRevision) return badge;
	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger asChild>{badge}</TooltipTrigger>
				<TooltipContent className="font-mono text-xs">
					reconciled to {app.syncRevision.slice(0, 9)}
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}

function DriftCell({ app }: { app: AppView }) {
	const { severity, flags } = app.drift;
	if (severity === "ok") {
		return <span className="text-muted-foreground">—</span>;
	}
	const summary =
		flags.length === 1 ? flags[0]!.kind : `${flags.length} issues`;
	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger asChild>
					<Badge variant={SEVERITY_BADGE[severity]}>{summary}</Badge>
				</TooltipTrigger>
				<TooltipContent className="max-w-sm">
					<ul className="list-disc space-y-1 pl-4">
						{flags.map((f) => (
							<li key={f.kind}>{f.message}</li>
						))}
					</ul>
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}

function ReleaseCell({ app }: { app: AppView }) {
	if (!app.declaredTag) {
		return <span className="text-muted-foreground">—</span>;
	}
	if (!app.releaseUrl) {
		return <Badge variant="red">no release</Badge>;
	}
	const label =
		app.releaseAssets === 0
			? "0 assets"
			: `${app.releaseAssets} asset${app.releaseAssets === 1 ? "" : "s"}`;
	return (
		<a
			href={app.releaseUrl}
			target="_blank"
			rel="noreferrer"
			className="inline-flex items-center gap-1 text-xs hover:underline"
		>
			<Badge variant={app.releaseAssets === 0 ? "red" : "green"}>{label}</Badge>
			<ExternalLink className="size-3 text-muted-foreground" />
		</a>
	);
}

/**
 * Where the service actually answers. The workload CR's `spec.ingress.hosts` is
 * the only authority on this, so the cell renders exactly what was observed — a
 * link per host, no host invented. Internal-only workloads declare no ingress,
 * and on clusters platform cannot read directly nobody reports hostnames at
 * all; both honestly show nothing.
 */
function HostCell({ hosts }: { hosts: string[] }) {
	if (hosts.length === 0) {
		return <span className="text-muted-foreground">—</span>;
	}
	return (
		<div className="flex flex-col gap-0.5">
			{hosts.map((h) => (
				<a
					key={h}
					href={`https://${h}`}
					target="_blank"
					rel="noreferrer"
					className="inline-flex items-center gap-1 font-mono text-xs hover:underline"
				>
					{h}
					<ExternalLink className="size-3 text-muted-foreground" />
				</a>
			))}
		</div>
	);
}

function HealthCell({ health }: { health: AppHealth | null }) {
	if (!health) return <Unknown />;
	return <Badge variant={HEALTH_BADGE[health]}>{health}</Badge>;
}

interface Props {
	apps: AppView[];
	summary: AppsSummary;
}

export function AppsBoard({ apps, summary }: Props) {
	const orgs = useMemo(() => orgsOf(apps), [apps]);
	const [org, setOrg] = useState<string | null>(null);

	const rows = useMemo(
		() => (org ? apps.filter((a) => a.org === org) : apps),
		[apps, org],
	);

	return (
		<div className="flex flex-col gap-4 p-6">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h1 className="text-2xl font-bold">Apps</h1>
					<p className="text-sm text-muted-foreground">
						Every org, every cluster. Declared / running / latest per app, what
						the deployer says about git, and the drift between them. Unobserved
						values read “unknown” — see docs/APPS_LIFECYCLE.md.
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Badge variant="green">{summary.byDrift.ok} ok</Badge>
					<Badge variant="yellow">{summary.byDrift.yellow} stale</Badge>
					<Badge variant="red">{summary.byDrift.red} drift</Badge>
					<span className="text-muted-foreground text-xs">
						{summary.bySync.drifted} out of sync · {summary.bySync.synced}{" "}
						synced
					</span>
				</div>
			</div>

			{/* One filter over one dataset — the orgs come from the rows themselves,
			    so this is a projection of the same view, never a per-org panel. */}
			<div className="flex flex-wrap items-center gap-2">
				<button
					type="button"
					onClick={() => setOrg(null)}
					className={`rounded-md border px-2.5 py-1 text-xs ${
						org === null ? "bg-muted font-medium" : "text-muted-foreground"
					}`}
				>
					all orgs ({summary.total})
				</button>
				{orgs.map((o) => (
					<button
						key={o}
						type="button"
						onClick={() => setOrg(o)}
						className={`rounded-md border px-2.5 py-1 text-xs ${
							org === o ? "bg-muted font-medium" : "text-muted-foreground"
						}`}
					>
						{o} ({summary.byOrg[o] ?? 0})
					</button>
				))}
			</div>

			<div className="overflow-x-auto rounded-lg border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Org/App</TableHead>
							<TableHead>Where</TableHead>
							<TableHead>Host</TableHead>
							<TableHead>Declared</TableHead>
							<TableHead>Running</TableHead>
							<TableHead>Latest</TableHead>
							<TableHead>Sync</TableHead>
							<TableHead>Drift</TableHead>
							<TableHead>GH Release</TableHead>
							<TableHead>Health</TableHead>
							<TableHead>Last seen</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{rows.length === 0 ? (
							<TableRow>
								<TableCell
									colSpan={11}
									className="text-center text-muted-foreground"
								>
									No apps recorded yet.
								</TableCell>
							</TableRow>
						) : (
							rows.map((app) => (
								<TableRow key={app.id}>
									<TableCell className="font-medium">
										{app.org}/{app.app}
									</TableCell>
									<TableCell className="whitespace-nowrap">
										<Badge variant="blank">{app.env}</Badge>
										<div className="font-mono text-[11px] text-muted-foreground">
											{app.cluster ?? "?"}/{app.namespace ?? "?"}
										</div>
									</TableCell>
									<TableCell>
										<HostCell hosts={app.hosts} />
									</TableCell>
									<TableCell>
										<TagCell tag={app.declaredTag} />
									</TableCell>
									<TableCell>
										<TagCell tag={app.runningTag} />
									</TableCell>
									<TableCell>
										<TagCell tag={app.latestTag} />
									</TableCell>
									<TableCell>
										<SyncCell app={app} />
									</TableCell>
									<TableCell>
										<DriftCell app={app} />
									</TableCell>
									<TableCell>
										<ReleaseCell app={app} />
									</TableCell>
									<TableCell>
										<HealthCell health={app.health} />
									</TableCell>
									<TableCell className="text-xs text-muted-foreground">
										{timeAgo(app.lastObserved)}
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>
		</div>
	);
}
