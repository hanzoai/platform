"use client";

import {
	Bookmark,
	BookText,
	CheckIcon,
	ChevronsUpDown,
	Globe,
	LayoutGrid,
	List,
	Loader2,
	SearchIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { GithubIcon } from "@/components/icons/data-tools-icons";
import { AlertBlock } from "@/components/shared/alert-block";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { api } from "@/utils/api";

const DEFAULT_TEMPLATE_BASE_URL = "https://templates.hanzo.ai";
const TEMPLATE_BASE_URL_KEY = "hanzo_template_base_url";
const PAGE_SIZE = 48;

/**
 * Build-provenance tags — which self-hosting catalog a blueprint was sourced
 * from — are source noise, not user-facing categories. Hidden from the
 * featured-tag quick filters (they remain searchable in the full tag popover).
 */
const PROVENANCE_TAGS = new Set([
	"caprover",
	"dokploy",
	"coolify",
	"casaos",
	"runtipi",
]);

/** Curated categories surfaced as one-click quick filters on the marketplace. */
const FEATURED_TAGS = [
	"self-hosted",
	"media",
	"productivity",
	"ai",
	"monitoring",
	"automation",
	"database",
];

/** The catalog row shape returned by `api.compose.templates`. */
export type TemplateSummary = {
	id: string;
	name: string;
	description: string;
	version: string;
	logo: string;
	links: { github: string; website?: string; docs?: string };
	tags: string[];
};

/**
 * Extracts `owner/repo` from a template's GitHub link so a maintainer can be
 * routed to the payout-claim funnel for exactly their project. Returns null
 * when the link is missing or not a github.com URL.
 */
function parseOwnerRepo(githubUrl?: string): string | null {
	if (!githubUrl) return null;
	const match = githubUrl.match(/github\.com\/([^/]+)\/([^/#?]+)/);
	if (!match) return null;
	const [, owner, rawRepo] = match;
	if (!owner || !rawRepo) return null;
	return `${owner}/${rawRepo.replace(/\.git$/, "")}`;
}

function logoUrl(
	baseUrl: string | undefined,
	template: TemplateSummary,
): string {
	const base = (baseUrl || DEFAULT_TEMPLATE_BASE_URL).replace(/\/$/, "");
	return `${base}/blueprints/${template.id}/${template.logo}`;
}

/**
 * A template logo that lazy-loads and degrades to a monogram when the image is
 * missing or 404s — keeps a 1000+ card grid smooth and gap-free.
 */
function TemplateLogo({
	src,
	name,
	size,
}: {
	src: string;
	name: string;
	size: "sm" | "lg";
}) {
	const [failed, setFailed] = useState(false);
	const dim = size === "lg" ? "size-24" : "size-16";

	if (failed) {
		return (
			<div
				className={cn(
					"flex items-center justify-center rounded-lg bg-muted font-semibold text-muted-foreground",
					size === "lg" ? "text-3xl" : "text-xl",
					dim,
				)}
			>
				{name.charAt(0).toUpperCase()}
			</div>
		);
	}

	return (
		// biome-ignore lint/performance/noImgElement: remote catalog logos, not local assets
		<img
			src={src}
			loading="lazy"
			onError={() => setFailed(true)}
			className={cn("object-contain", dim)}
			alt={name}
		/>
	);
}

interface TemplateGalleryProps {
	/** Whether the catalog queries run — dialog passes `open`, the page passes true. */
	enabled?: boolean;
	/** External base-URL override (self-hosted catalogs); else localStorage. */
	baseUrl?: string;
	/** Render the "Base URL (optional)" input in the controls row. */
	showBaseUrlInput?: boolean;
	/** Render the curated featured-tag quick filters above the grid. */
	showFeaturedTags?: boolean;
	/** Render the per-card "Maintainer? Earn 20%" payout hook (marketplace). */
	showPayoutHook?: boolean;
	/** The deploy/create control for a card — the only per-context difference. */
	renderAction: (
		template: TemplateSummary,
		baseUrl: string | undefined,
	) => React.ReactNode;
}

/**
 * The one-and-only template browse experience: catalog fetch, search, tag +
 * bookmark filtering, and the card grid. Shared verbatim by the in-project
 * "Create from Template" dialog and the standalone OSS Templates marketplace —
 * the per-context difference is a single injected action control.
 */
export function TemplateGallery({
	enabled = true,
	baseUrl,
	showBaseUrlInput = false,
	showFeaturedTags = false,
	showPayoutHook = false,
	renderAction,
}: TemplateGalleryProps) {
	const [query, setQuery] = useState("");
	const [viewMode, setViewMode] = useState<"detailed" | "icon">("detailed");
	const [selectedTags, setSelectedTags] = useState<string[]>([]);
	const [showBookmarksOnly, setShowBookmarksOnly] = useState(false);
	const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
	const [customBaseUrl, setCustomBaseUrl] = useState<string | undefined>(() => {
		if (baseUrl) return baseUrl;
		if (typeof window !== "undefined") {
			return localStorage.getItem(TEMPLATE_BASE_URL_KEY) || undefined;
		}
		return undefined;
	});

	useEffect(() => {
		if (customBaseUrl) {
			localStorage.setItem(TEMPLATE_BASE_URL_KEY, customBaseUrl);
		} else {
			localStorage.removeItem(TEMPLATE_BASE_URL_KEY);
		}
	}, [customBaseUrl]);

	const {
		data,
		isLoading: isLoadingTemplates,
		error: errorTemplates,
		isError: isErrorTemplates,
	} = api.compose.templates.useQuery({ baseUrl: customBaseUrl }, { enabled });

	const { data: tags, isPending: isLoadingTags } = api.compose.getTags.useQuery(
		{ baseUrl: customBaseUrl },
		{ enabled },
	);

	const { data: bookmarkIds = [], isLoading: isLoadingBookmarks } =
		api.user.getBookmarkedTemplates.useQuery(undefined, { enabled });

	const utils = api.useUtils();
	const { mutateAsync: toggleBookmark } =
		api.user.toggleTemplateBookmark.useMutation({
			onMutate: async ({ templateId }) => {
				await utils.user.getBookmarkedTemplates.cancel();
				const previousBookmarks = utils.user.getBookmarkedTemplates.getData();
				utils.user.getBookmarkedTemplates.setData(undefined, (old = []) =>
					old.includes(templateId)
						? old.filter((id) => id !== templateId)
						: [...old, templateId],
				);
				return { previousBookmarks };
			},
			onError: (_err, _variables, context) => {
				if (context?.previousBookmarks) {
					utils.user.getBookmarkedTemplates.setData(
						undefined,
						context.previousBookmarks,
					);
				}
				toast.error("Failed to update bookmark");
			},
			onSuccess: (data) => {
				toast.success(
					data.isBookmarked ? "Added to bookmarks" : "Removed from bookmarks",
				);
			},
		});

	const templates = useMemo<TemplateSummary[]>(() => {
		return (
			(data as TemplateSummary[] | undefined)?.filter((template) => {
				const matchesTags =
					selectedTags.length === 0 ||
					template.tags.some((tag) => selectedTags.includes(tag));
				const matchesQuery =
					query === "" ||
					template.name.toLowerCase().includes(query.toLowerCase()) ||
					template.description.toLowerCase().includes(query.toLowerCase());
				const matchesBookmarks =
					!showBookmarksOnly || bookmarkIds.includes(template.id);
				return matchesTags && matchesQuery && matchesBookmarks;
			}) || []
		);
	}, [data, selectedTags, query, showBookmarksOnly, bookmarkIds]);

	// Reset the render window whenever the result set changes so "Load more"
	// never strands the user deep in a stale, longer list.
	useEffect(() => {
		setVisibleCount(PAGE_SIZE);
	}, [query, selectedTags, showBookmarksOnly]);

	const featuredTags = useMemo(
		() =>
			FEATURED_TAGS.filter(
				(tag) => !PROVENANCE_TAGS.has(tag) && (tags ?? []).includes(tag),
			),
		[tags],
	);

	const visible = templates.slice(0, visibleCount);
	const remaining = templates.length - visible.length;

	const toggleTag = (tag: string) =>
		setSelectedTags((prev) =>
			prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
		);

	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-col gap-4 sticky top-0 z-10 bg-background pb-2">
				<div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
					<Input
						placeholder="Search 1000+ open-source apps"
						onChange={(e) => setQuery(e.target.value)}
						className="w-full"
						value={query}
					/>
					{showBaseUrlInput && (
						<Input
							placeholder="Base URL (optional)"
							onChange={(e) => setCustomBaseUrl(e.target.value || undefined)}
							className="w-full sm:w-[240px]"
							value={customBaseUrl || ""}
						/>
					)}
					<Popover modal={true}>
						<PopoverTrigger asChild>
							<Button
								variant="outline"
								className={cn("w-full sm:w-[200px] justify-between !bg-input")}
							>
								{isLoadingTags
									? "Loading...."
									: selectedTags.length > 0
										? `Selected ${selectedTags.length} tags`
										: "Select tag"}
								<ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
							</Button>
						</PopoverTrigger>
						<PopoverContent className="p-0" align="start">
							<Command>
								<CommandInput placeholder="Search tag..." className="h-9" />
								{isLoadingTags && (
									<span className="py-6 text-center text-sm">
										Loading Tags....
									</span>
								)}
								<CommandEmpty>No tags found.</CommandEmpty>
								<ScrollArea className="h-96">
									<CommandGroup>
										{tags?.map((tag) => (
											<CommandItem
												value={tag}
												key={tag}
												onSelect={() => toggleTag(tag)}
											>
												{tag}
												<CheckIcon
													className={cn(
														"ml-auto h-4 w-4",
														selectedTags.includes(tag)
															? "opacity-100"
															: "opacity-0",
													)}
												/>
											</CommandItem>
										))}
									</CommandGroup>
								</ScrollArea>
							</Command>
						</PopoverContent>
					</Popover>
					<Button
						variant={showBookmarksOnly ? "default" : "outline"}
						size="icon"
						onClick={() => setShowBookmarksOnly(!showBookmarksOnly)}
						className="h-9 w-9 flex-shrink-0"
						disabled={isLoadingBookmarks}
					>
						<Bookmark
							className={cn("size-4", showBookmarksOnly && "fill-current")}
						/>
					</Button>
					<Button
						size="icon"
						onClick={() =>
							setViewMode(viewMode === "detailed" ? "icon" : "detailed")
						}
						className="h-9 w-9 flex-shrink-0"
					>
						{viewMode === "detailed" ? (
							<LayoutGrid className="size-4" />
						) : (
							<List className="size-4" />
						)}
					</Button>
				</div>

				{showFeaturedTags && featuredTags.length > 0 && (
					<div className="flex flex-wrap gap-2">
						{featuredTags.map((tag) => (
							<Badge
								key={tag}
								variant={selectedTags.includes(tag) ? "default" : "secondary"}
								className="cursor-pointer capitalize"
								onClick={() => toggleTag(tag)}
							>
								{tag}
							</Badge>
						))}
					</div>
				)}

				{selectedTags.length > 0 && (
					<div className="flex flex-wrap gap-2">
						{selectedTags.map((tag) => (
							<Badge
								key={tag}
								variant="secondary"
								className="cursor-pointer"
								onClick={() => toggleTag(tag)}
							>
								{tag} ×
							</Badge>
						))}
					</div>
				)}
			</div>

			{isErrorTemplates && (
				<AlertBlock type="error">{errorTemplates?.message}</AlertBlock>
			)}

			{isLoadingTemplates ? (
				<div className="flex justify-center items-center w-full flex-row gap-4 min-h-[50vh]">
					<Loader2 className="size-8 text-muted-foreground animate-spin" />
					<div className="text-lg font-medium text-muted-foreground">
						Loading templates...
					</div>
				</div>
			) : templates.length === 0 ? (
				<div className="flex flex-col justify-center items-center w-full gap-2 min-h-[40vh]">
					<SearchIcon className="text-muted-foreground size-6" />
					<div className="text-xl font-medium text-muted-foreground">
						{showBookmarksOnly
							? "No bookmarked templates found"
							: "No templates found"}
					</div>
					{showBookmarksOnly && (
						<p className="text-sm text-muted-foreground">
							Click the bookmark icon on a template to add it here
						</p>
					)}
				</div>
			) : (
				<>
					<div className="text-sm text-muted-foreground">
						Showing {visible.length} of {templates.length} apps
					</div>
					<div
						className={cn(
							"grid gap-6",
							viewMode === "detailed"
								? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
								: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6",
						)}
					>
						{visible.map((template, idx) => {
							const ownerRepo = parseOwnerRepo(template.links?.github);
							return (
								<div
									key={`${template.id}-${idx}`}
									className={cn(
										"flex flex-col border rounded-lg overflow-hidden relative",
										viewMode === "icon" && "h-[200px]",
										viewMode === "detailed" && "h-[400px]",
									)}
								>
									<div className="absolute top-2 left-2 z-10">
										<Button
											variant="ghost"
											size="icon"
											className="h-8 w-8 bg-background/80 backdrop-blur-sm hover:bg-background"
											onClick={(e) => {
												e.stopPropagation();
												toggleBookmark({ templateId: template.id });
											}}
										>
											<Bookmark
												className={cn(
													"size-4",
													bookmarkIds.includes(template.id) &&
														"fill-yellow-400 text-yellow-400",
												)}
											/>
										</Button>
									</div>
									<div className="absolute top-2 right-2">
										<Badge variant="blue">{template.version}</Badge>
									</div>
									<div
										className={cn(
											"flex-none p-6 pb-3 flex flex-col items-center gap-4 bg-muted/30",
											viewMode === "detailed" && "border-b",
										)}
									>
										<TemplateLogo
											src={logoUrl(customBaseUrl, template)}
											name={template.name}
											size={viewMode === "detailed" ? "lg" : "sm"}
										/>
										<div className="flex flex-col items-center gap-2">
											<span className="text-sm font-medium line-clamp-1">
												{template.name}
											</span>
											{viewMode === "detailed" && template.tags?.length > 0 && (
												<div className="flex flex-wrap justify-center gap-1.5">
													{template.tags.map((tag) => (
														<Badge
															key={tag}
															variant="green"
															className="text-[10px] px-2 py-0"
														>
															{tag}
														</Badge>
													))}
												</div>
											)}
										</div>
									</div>

									{viewMode === "detailed" && (
										<ScrollArea className="flex-1 p-6">
											<div className="text-sm text-muted-foreground">
												{template.description}
											</div>
										</ScrollArea>
									)}

									<div className="flex-none mt-auto border-t bg-muted/30">
										<div
											className={cn(
												"px-6 py-3",
												viewMode === "detailed"
													? "flex items-center justify-between"
													: "flex justify-center",
											)}
										>
											{viewMode === "detailed" && (
												<div className="flex gap-2">
													{template.links?.github && (
														<Link
															href={template.links.github}
															target="_blank"
															className="text-muted-foreground hover:text-foreground transition-colors"
														>
															<GithubIcon className="size-5" />
														</Link>
													)}
													{template.links?.website && (
														<Link
															href={template.links.website}
															target="_blank"
															className="text-muted-foreground hover:text-foreground transition-colors"
														>
															<Globe className="size-5" />
														</Link>
													)}
													{template.links?.docs && (
														<Link
															href={template.links.docs}
															target="_blank"
															className="text-muted-foreground hover:text-foreground transition-colors"
														>
															<BookText className="size-5" />
														</Link>
													)}
												</div>
											)}
											{renderAction(template, customBaseUrl)}
										</div>
										{showPayoutHook && viewMode === "detailed" && ownerRepo && (
											<Link
												href={`https://console.hanzo.ai/authors?claim=${encodeURIComponent(ownerRepo)}`}
												target="_blank"
												className="block border-t px-6 py-2 text-[11px] text-muted-foreground hover:text-primary transition-colors"
											>
												Maintainer? Earn 20% →
											</Link>
										)}
									</div>
								</div>
							);
						})}
					</div>

					{remaining > 0 && (
						<div className="flex justify-center pt-2">
							<Button
								variant="outline"
								onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
							>
								Load more ({remaining} remaining)
							</Button>
						</div>
					)}
				</>
			)}
		</div>
	);
}
