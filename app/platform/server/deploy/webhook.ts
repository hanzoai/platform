/**
 * Deploy-webhook helpers — provider-agnostic parsing of git/registry webhook
 * payloads (commit message, hash, branch, image name/tag, provider detection).
 *
 * These are pure functions over `(headers, body)`: the ONE home for webhook
 * payload extraction, shared by the /v1/deploy/* route handlers AND the unit
 * tests. Headers are the Node-lowercased shape (`Record<string, string | …>`);
 * the App Router routes fold their `Request` headers into that shape before
 * calling in.
 */
import { type Bitbucket, getBitbucketHeaders } from "@hanzo/platform";

/** A plain, lowercased-key header bag (Node `IncomingMessage.headers` shape). */
export type WebhookHeaders = Record<string, string | string[] | undefined>;

/**
 * Log a webhook handler error server-side without leaking its shape to the HTTP
 * response. Drizzle errors carry the raw SQL query, column list and parameters,
 * so we never forward the error object to the client.
 */
export const logWebhookError = (context: string, error: unknown) => {
	console.error(context, error);
};

/**
 * Helper function to get package_version from registry_package events
 */
const getPackageVersion = (headers: any, body: any) => {
	const event = headers["x-github-event"];
	if (event === "registry_package") {
		return body.registry_package?.package_version;
	}
	return null;
};

/**
 * Return the image name without the tag
 * Example: "my-image" => "my-image"
 * Example: "my-image:latest" => "my-image"
 * Example: "my-image:1.0.0" => "my-image"
 * Example: "myregistryhost:5000/fedora/httpd:version1.0" => "myregistryhost:5000/fedora/httpd"
 * @link https://docs.docker.com/reference/cli/docker/image/tag/
 */
export function extractImageName(dockerImage: string | null): string | null {
	if (!dockerImage || typeof dockerImage !== "string") {
		return null;
	}

	// Handle case where there's no tag (no colon or colon is part of port number)
	const lastColonIndex = dockerImage.lastIndexOf(":");
	if (lastColonIndex === -1) {
		return dockerImage;
	}

	// Check if the part after the last colon looks like a tag (not a port number)
	// Port numbers are typically 1-5 digits, tags are usually longer or contain letters
	const afterColon = dockerImage.substring(lastColonIndex + 1);
	const isPortNumber = /^\d{1,5}$/.test(afterColon);

	// If it's a port number (like registry:5000/image), don't split
	if (isPortNumber) {
		return dockerImage;
	}

	// Otherwise, split at the last colon to get image name
	return dockerImage.substring(0, lastColonIndex);
}

/**
 * Return the last part of the image name, which is the tag
 * Example: "my-image" => null
 * Example: "my-image:latest" => "latest"
 * Example: "my-image:1.0.0" => "1.0.0"
 * Example: "myregistryhost:5000/fedora/httpd:version1.0" => "version1.0"
 * @link https://docs.docker.com/reference/cli/docker/image/tag/
 */
export function extractImageTag(dockerImage: string | null) {
	if (!dockerImage || typeof dockerImage !== "string") {
		return null;
	}

	const lastColonIndex = dockerImage.lastIndexOf(":");
	if (lastColonIndex === -1) {
		return "latest";
	}

	const afterColon = dockerImage.substring(lastColonIndex + 1);
	const isPortWithPath = /^\d{1,5}\//.test(afterColon);

	if (isPortWithPath) {
		return "latest";
	}

	return afterColon;
}

/**
 * Extract the image name (without tag) from webhook request
 * @link https://docs.docker.com/docker-hub/webhooks/#example-webhook-payload
 * @link https://docs.github.com/en/webhooks/webhook-events-and-payloads#registry_package
 */
export const extractImageNameFromRequest = (
	headers: any,
	body: any,
): string | null => {
	// GitHub Packages: registry_package events (container registry)
	const packageVersion = getPackageVersion(headers, body);
	if (packageVersion?.package_url) {
		const packageUrl = packageVersion.package_url;
		// Remove tag if present (everything after the last colon)
		if (packageUrl.includes(":")) {
			const lastColonIndex = packageUrl.lastIndexOf(":");
			// Check if it's a port number (like registry:5000/image)
			const afterColon = packageUrl.substring(lastColonIndex + 1);
			const isPortNumber = /^\d{1,5}$/.test(afterColon);
			if (isPortNumber) {
				return packageUrl;
			}
			return packageUrl.substring(0, lastColonIndex);
		}
		return packageUrl;
	}

	// Docker Hub
	if (headers["user-agent"]?.includes("Go-http-client")) {
		if (body.repository) {
			const repoName = body.repository.repo_name;
			return `${repoName}`;
		}
	}
	return null;
};

/**
 * @link https://docs.docker.com/docker-hub/webhooks/#example-webhook-payload
 * @link https://docs.github.com/en/webhooks/webhook-events-and-payloads#registry_package
 */
export const extractImageTagFromRequest = (
	headers: any,
	body: any,
): string | null => {
	// GitHub Packages: registry_package events (container registry)
	const packageVersion = getPackageVersion(headers, body);
	if (packageVersion) {
		// Try to get tag from container_metadata first (most reliable)
		// Only use it if it's not empty and not the same as the version (digest)
		const tagName = packageVersion.container_metadata?.tag?.name?.trim() || "";
		if (
			tagName &&
			tagName !== packageVersion.version &&
			!tagName.startsWith("sha256:")
		) {
			return tagName;
		}
		// Fallback: extract tag from package_url (e.g., "ghcr.io/owner/repo:tag")
		if (packageVersion.package_url) {
			const packageUrl = packageVersion.package_url;
			// Handle case where package_url ends with colon (no tag)
			if (packageUrl.endsWith(":")) {
				return null;
			}
			const tagMatch = packageUrl.match(/:([^:]+)$/);
			if (tagMatch?.[1]?.trim()) {
				return tagMatch[1].trim();
			}
		}
	}

	// Docker Hub
	if (headers["user-agent"]?.includes("Go-http-client")) {
		if (body.push_data && body.repository) {
			return body.push_data.tag;
		}
	}
	return null;
};

export const extractCommitMessage = (headers: any, body: any) => {
	// GitHub Packages: registry_package events (container tags)
	const githubEvent = headers["x-github-event"];
	if (githubEvent === "registry_package") {
		const packageVersion = getPackageVersion(headers, body);
		if (packageVersion) {
			if (packageVersion.package_url) {
				return `Docker GHCR image pushed: ${packageVersion.package_url}`;
			}
			return "Docker GHCR image pushed";
		}
		// If package_version is missing, fall through to default behavior
	}
	// GitHub
	if (headers["x-github-event"]) {
		return body.head_commit ? body.head_commit.message : "NEW COMMIT";
	}

	// GitLab
	if (headers["x-gitlab-event"]) {
		return body.commits && body.commits.length > 0
			? body.commits[0].message
			: "NEW COMMIT";
	}

	// Bitbucket
	if (headers["x-event-key"]?.includes("repo:push")) {
		return body.push.changes && body.push.changes.length > 0
			? body.push.changes[0].new.target.message
			: "NEW COMMIT";
	}

	// Gitea
	if (headers["x-gitea-event"]) {
		return body.commits && body.commits.length > 0
			? body.commits[0].message
			: "NEW COMMIT";
	}

	// Soft Serve
	if (headers["x-softserve-event"]) {
		return body.commits && body.commits.length > 0
			? body.commits[0].message
			: "NEW COMMIT";
	}

	if (headers["user-agent"]?.includes("Go-http-client")) {
		if (body.push_data && body.repository) {
			return `DockerHub image pushed: ${body.repository.repo_name}:${body.push_data.tag} by ${body.push_data.pusher}`;
		}
	}

	return "NEW CHANGES";
};

export const extractHash = (headers: any, body: any) => {
	// GitHub
	if (headers["x-github-event"]) {
		return body.head_commit ? body.head_commit.id : "";
	}

	// GitLab
	if (headers["x-gitlab-event"]) {
		return (
			body.checkout_sha ||
			(body.commits && body.commits.length > 0
				? body.commits[0].id
				: "NEW COMMIT")
		);
	}

	// Bitbucket
	if (headers["x-event-key"]?.includes("repo:push")) {
		return body.push.changes && body.push.changes.length > 0
			? body.push.changes[0].new.target.hash
			: "NEW COMMIT";
	}

	// Gitea
	if (headers["x-gitea-event"]) {
		return body.after || "NEW COMMIT";
	}

	// Soft Serve
	if (headers["x-softserve-event"]) {
		return body.after || "NEW COMMIT";
	}

	return "";
};

export const extractBranchName = (headers: any, body: any) => {
	if (headers["x-github-event"] || headers["x-gitea-event"]) {
		return body?.ref?.replace("refs/heads/", "");
	}

	if (
		headers["x-gitlab-event"] ||
		headers["x-softserve-event"]?.includes("push")
	) {
		return body?.ref ? body?.ref.replace("refs/heads/", "") : null;
	}

	if (headers["x-event-key"]?.includes("repo:push")) {
		return body?.push?.changes[0]?.new?.name;
	}

	return null;
};

export const getProviderByHeader = (headers: any) => {
	if (headers["x-github-event"]) {
		return "github";
	}

	if (headers["x-gitea-event"]) {
		return "gitea";
	}

	if (headers["x-gitlab-event"]) {
		return "gitlab";
	}

	if (headers["x-event-key"]?.includes("repo:push")) {
		return "bitbucket";
	}

	if (headers["x-softserve-event"]) {
		return "soft-serve";
	}

	return null;
};

export const extractCommittedPaths = async (
	body: any,
	bitbucket: Bitbucket | null,
	repository: string,
) => {
	const changes = body.push?.changes || [];

	const commitHashes = changes
		.map((change: any) => change.new?.target?.hash)
		.filter(Boolean);
	const committedPaths: string[] = [];
	const username =
		bitbucket?.bitbucketWorkspaceName || bitbucket?.bitbucketUsername || "";
	for (const commit of commitHashes) {
		const url = `https://api.bitbucket.org/2.0/repositories/${username}/${repository}/diffstat/${commit}`;
		try {
			const response = await fetch(url, {
				headers: getBitbucketHeaders(bitbucket!),
			});
			const data = await response.json();
			for (const value of data.values) {
				if (value?.new?.path) committedPaths.push(value.new.path);
			}
		} catch (error) {
			console.error(
				`Error fetching Bitbucket diffstat for commit ${commit}:`,
				error instanceof Error ? error.message : "Unknown error",
			);

			return [];
		}
	}

	return committedPaths;
};

/**
 * Fold a WHATWG `Request`'s headers into the Node-lowercased header bag the
 * extractors expect. App Router routes call this at the boundary so all payload
 * parsing stays on the single `(headers, body)` contract above.
 */
export function foldHeaders(req: Request): WebhookHeaders {
	const headers: Record<string, string> = {};
	req.headers.forEach((value, key) => {
		headers[key.toLowerCase()] = value;
	});
	return headers;
}
