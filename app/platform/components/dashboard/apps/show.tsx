import type { AppWithDrift, DriftLevel } from "@hanzo/platform/services/apps";
import { ExternalLink, Layers, Loader2, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { DateTooltip } from "@/components/shared/date-tooltip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { api } from "@/utils/api";

const ALL = "all" as const;

type EnvFilter = typeof ALL | "dev" | "test" | "main";
type HealthFilter = typeof ALL | "green" | "yellow" | "red";

/** Drift level → badge variant. The drift column is the page's keystone:
 *  red = policy/release violation, yellow = rollout lag, green = in sync. */
const DRIFT_VARIANT: Record<DriftLevel, "green" | "yellow" | "red" | "blank"> =
	{
		ok: "green",
		warn: "yellow",
		error: "red",
		unknown: "blank",
	};

/** Short label for the drift badge, by drift kind. */
const DRIFT_LABEL: Record<AppWithDrift["drift"]["kind"], string> = {
	none: "in sync",
	stale: "stale",
	"un-rolled": "un-rolled",
	floating: "floating",
	"no-release": "no release",
	unknown: "unknown",
};

const HEALTH_VARIANT: Record<string, "green" | "yellow" | "red" | "blank"> = {
	green: "green",
	yellow: "yellow",
	red: "red",
};

/** A tag cell that renders `—` for an unobserved tag and dims floating refs. */
const Tag = ({ value }: { value: string | null }) => {
	if (!value) {
		return <span className="text-muted-foreground">—</span>;
	}
	const semver = /^v\d+\.\d+\.\d+$/.test(value);
	return (
		<span
			className={
				semver ? "font-mono text-sm" : "font-mono text-sm text-orange-500"
			}
			title={semver ? undefined : "floating reference (not semver)"}
		>
			{value}
		</span>
	);
};

/**
 * ShowApps — the apps-lifecycle drift view (`docs/APPS_LIFECYCLE.md` §6).
 *
 * Renders every (org, app, env) row with declared vs running vs latest tags and
 * a derived drift indicator. Filters by org / env / health drive the same
 * `apps.all` query the REST `/v1/apps` endpoint serves, so the table is exactly
 * what the API reports. Drift is computed server-side (single source of truth);
 * this component only maps it to colors.
 */
export const ShowApps = () => {
	const [org, setOrg] = useState<string>(ALL);
	const [env, setEnv] = useState<EnvFilter>(ALL);
	const [health, setHealth] = useState<HealthFilter>(ALL);

	const { data, isLoading, isRefetching, refetch } = api.apps.all.useQuery({
		org: org === ALL ? undefined : org,
		env: env === ALL ? undefined : env,
		health: health === ALL ? undefined : health,
	});

	// Org options come from the full result so the filter never hides an org.
	const orgs = useMemo(() => {
		const set = new Set<string>();
		for (const row of data ?? []) {
			set.add(row.org);
		}
		return Array.from(set).sort();
	}, [data]);

	const driftCount = useMemo(
		() => (data ?? []).filter((r) => r.drift.level !== "ok").length,
		[data],
	);

	return (
		<Card className="bg-transparent">
			<CardHeader className="flex flex-row items-start justify-between">
				<div>
					<CardTitle className="flex items-center gap-2 text-xl">
						<Layers className="size-5" /> Apps
					</CardTitle>
					<CardDescription>
						Declared vs running vs latest version for every service and
						environment. Drift surfaces immediately — see{" "}
						<span className="font-mono">docs/APPS_LIFECYCLE.md</span>.
					</CardDescription>
				</div>
				<Button
					variant="outline"
					size="sm"
					onClick={() => refetch()}
					disabled={isRefetching}
				>
					{isRefetching ? (
						<Loader2 className="size-4 animate-spin" />
					) : (
						<RefreshCw className="size-4" />
					)}
					Refresh
				</Button>
			</CardHeader>
			<CardContent className="space-y-4 border-t pt-6">
				<div className="flex flex-wrap items-center gap-3">
					<Select value={org} onValueChange={(v) => setOrg(v)}>
						<SelectTrigger className="w-[160px]">
							<SelectValue placeholder="Org" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={ALL}>All orgs</SelectItem>
							{orgs.map((o) => (
								<SelectItem key={o} value={o}>
									{o}
								</SelectItem>
							))}
						</SelectContent>
					</Select>

					<Select value={env} onValueChange={(v) => setEnv(v as EnvFilter)}>
						<SelectTrigger className="w-[140px]">
							<SelectValue placeholder="Env" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={ALL}>All envs</SelectItem>
							<SelectItem value="main">main</SelectItem>
							<SelectItem value="test">test</SelectItem>
							<SelectItem value="dev">dev</SelectItem>
						</SelectContent>
					</Select>

					<Select
						value={health}
						onValueChange={(v) => setHealth(v as HealthFilter)}
					>
						<SelectTrigger className="w-[150px]">
							<SelectValue placeholder="Health" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={ALL}>All health</SelectItem>
							<SelectItem value="green">green</SelectItem>
							<SelectItem value="yellow">yellow</SelectItem>
							<SelectItem value="red">red</SelectItem>
						</SelectContent>
					</Select>

					{data && (
						<span className="ml-auto text-sm text-muted-foreground">
							{data.length} app{data.length === 1 ? "" : "s"}
							{driftCount > 0 && (
								<>
									{" · "}
									<span className="text-yellow-500">{driftCount} drifting</span>
								</>
							)}
						</span>
					)}
				</div>

				{isLoading ? (
					<div className="flex min-h-[40vh] items-center justify-center">
						<Loader2 className="size-6 animate-spin text-muted-foreground" />
					</div>
				) : !data || data.length === 0 ? (
					<div className="flex min-h-[30vh] flex-col items-center justify-center gap-2 text-muted-foreground">
						<Layers className="size-8 opacity-50" />
						<span>No apps recorded yet.</span>
						<span className="text-xs">
							Seed the table and run the lifecycle readers (PR 2) to populate
							observed tags.
						</span>
					</div>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Org / App</TableHead>
								<TableHead>Env</TableHead>
								<TableHead>Declared</TableHead>
								<TableHead>Running</TableHead>
								<TableHead>Latest</TableHead>
								<TableHead>Drift</TableHead>
								<TableHead>Release</TableHead>
								<TableHead>Health</TableHead>
								<TableHead className="text-right">Last seen</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{data.map((row) => (
								<TableRow key={row.id}>
									<TableCell className="font-medium">
										{row.org}/{row.app}
									</TableCell>
									<TableCell>
										<Badge variant="blank">{row.env}</Badge>
									</TableCell>
									<TableCell>
										<Tag value={row.declaredTag} />
									</TableCell>
									<TableCell>
										<Tag value={row.runningTag} />
									</TableCell>
									<TableCell>
										<Tag value={row.latestTag} />
									</TableCell>
									<TableCell>
										<Badge
											variant={DRIFT_VARIANT[row.drift.level]}
											title={row.drift.reason}
										>
											{row.drift.level === "ok"
												? "—"
												: DRIFT_LABEL[row.drift.kind]}
										</Badge>
									</TableCell>
									<TableCell>
										{row.releaseUrl ? (
											<a
												href={row.releaseUrl}
												target="_blank"
												rel="noreferrer"
												className="inline-flex items-center gap-1 text-sm hover:underline"
											>
												{row.releaseAssets} asset
												{row.releaseAssets === 1 ? "" : "s"}
												<ExternalLink className="size-3" />
											</a>
										) : (
											<span className="text-muted-foreground">—</span>
										)}
									</TableCell>
									<TableCell>
										{row.health ? (
											<Badge variant={HEALTH_VARIANT[row.health] ?? "blank"}>
												{row.health}
											</Badge>
										) : (
											<span className="text-muted-foreground">—</span>
										)}
									</TableCell>
									<TableCell className="text-right text-sm text-muted-foreground">
										{row.lastObserved ? (
											<DateTooltip
												date={row.lastObserved as unknown as string}
											/>
										) : (
											"never"
										)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</CardContent>
		</Card>
	);
};
