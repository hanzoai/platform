import { getDockerCommand } from "@hanzo/platform/utils/builders/docker-file";
import { getCreateFileCommand } from "../docker/utils";
import { getBuildAppDirectory } from "../filesystem/directory";
import type { ApplicationNested } from ".";

/**
 * SPA entrypoint: serves static files from /srv, falls back to /srv/index.html
 * for any path that does not match a real file (client-side routing).
 */
const spaEntrypoint = `#!/bin/sh
# Serve static files; httpd.conf maps 404 -> /index.html for SPA routing.
exec httpd -f -p 80 -h /srv -c /etc/httpd.conf
`;

const spaHttpdConf = `E404:/index.html
`;

export const getStaticCommand = (application: ApplicationNested) => {
	const { publishDirectory, isStaticSpa } = application;
	const buildAppDirectory = getBuildAppDirectory(application);
	let command = "";

	if (isStaticSpa) {
		command += getCreateFileCommand(buildAppDirectory, "entrypoint.sh", spaEntrypoint);
		command += getCreateFileCommand(buildAppDirectory, "httpd.conf", spaHttpdConf);
	}

	command += getCreateFileCommand(
		buildAppDirectory,
		".dockerignore",
		[".git", ".env", "Dockerfile", ".dockerignore"].join("\n"),
	);

	command += getCreateFileCommand(
		buildAppDirectory,
		"Dockerfile",
		[
			"FROM busybox:latest",
			`COPY ${publishDirectory || "."} /srv`,
			...(isStaticSpa
				? [
						"COPY entrypoint.sh /entrypoint.sh",
						"COPY httpd.conf /etc/httpd.conf",
						"RUN chmod +x /entrypoint.sh",
						"EXPOSE 80",
						'CMD ["/entrypoint.sh"]',
					]
				: [
						"EXPOSE 80",
						'CMD ["httpd", "-f", "-p", "80", "-h", "/srv"]',
					]),
		].join("\n"),
	);

	command += getDockerCommand({
		...application,
		buildType: "dockerfile",
		dockerfile: "Dockerfile",
	});
	return command;
};
