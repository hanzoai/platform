import { ExternalLink } from "lucide-react";
import type {
	AppHealth,
	AppView,
	AppsSummary,
} from "@/server/apps/apps-api";
import type { DriftSeverity } from "@hanzo/platform/db/schema";
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

/**
 * The apps-lifecycle drift board (PR 3 of APPS_LIFECYCLE.md). Pure presentation
 * over the `AppView[]` the `/v1/apps` API returns: it renders declared /
 * running / latest tags and the computed drift verdict per the contract's drift
 * view. Drift severity is the page's keystone — yellow = stale declaration,
 * red = floating tag or missing release artifacts.
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

function TagCell({ tag }: { tag: string | null }) {
	if (!tag) return <span className="text-muted-foreground">—</span>;
	return <span className="font-mono text-xs">{tag}</span>;
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

function HealthCell({ health }: { health: AppHealth | null }) {
	if (!health) return <span className="text-muted-foreground">—</span>;
	return <Badge variant={HEALTH_BADGE[health]}>{health}</Badge>;
}

interface Props {
	apps: AppView[];
	summary: AppsSummary;
}

export function AppsBoard({ apps, summary }: Props) {
	return (
		<div className="flex flex-col gap-4 p-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold">Apps</h1>
					<p className="text-sm text-muted-foreground">
						Declared / running / latest per app and env. Drift surfaces here —
						see docs/APPS_LIFECYCLE.md.
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Badge variant="green">{summary.byDrift.ok} ok</Badge>
					<Badge variant="yellow">{summary.byDrift.yellow} stale</Badge>
					<Badge variant="red">{summary.byDrift.red} drift</Badge>
				</div>
			</div>

			<div className="rounded-lg border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Org/App</TableHead>
							<TableHead>Env</TableHead>
							<TableHead>Declared</TableHead>
							<TableHead>Running</TableHead>
							<TableHead>Latest</TableHead>
							<TableHead>Drift</TableHead>
							<TableHead>GH Release</TableHead>
							<TableHead>Health</TableHead>
							<TableHead>Last seen</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{apps.length === 0 ? (
							<TableRow>
								<TableCell
									colSpan={9}
									className="text-center text-muted-foreground"
								>
									No apps recorded yet.
								</TableCell>
							</TableRow>
						) : (
							apps.map((app) => (
								<TableRow key={app.id}>
									<TableCell className="font-medium">
										{app.org}/{app.app}
									</TableCell>
									<TableCell>
										<Badge variant="blank">{app.env}</Badge>
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
