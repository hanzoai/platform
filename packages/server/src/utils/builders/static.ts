import { getDockerCommand } from "@hanzo/platform-server/utils/builders/docker-file";
import { getCreateFileCommand } from "../docker/utils";
import { getBuildAppDirectory } from "../filesystem/directory";
import type { ApplicationNested } from ".";

const caddyfileSpa = `
:80 {
	root * /srv
	encode gzip
	try_files {path} /index.html
	file_server
	handle /health {
		respond "ok" 200
	}
}
`;

const caddyfileStatic = `
:80 {
	root * /srv
	encode gzip
	file_server
	handle /health {
		respond "ok" 200
	}
}
`;

export const getStaticCommand = (application: ApplicationNested) => {
	const { publishDirectory, isStaticSpa } = application;
	const buildAppDirectory = getBuildAppDirectory(application);
	let command = "";

	command += getCreateFileCommand(
		buildAppDirectory,
		"Caddyfile",
		isStaticSpa ? caddyfileSpa : caddyfileStatic,
	);

	command += getCreateFileCommand(
		buildAppDirectory,
		".dockerignore",
		[".git", ".env", "Dockerfile", ".dockerignore"].join("\n"),
	);

	command += getCreateFileCommand(
		buildAppDirectory,
		"Dockerfile",
		[
			"FROM caddy:alpine",
			`COPY ${publishDirectory || "."} /srv`,
			"COPY Caddyfile /etc/caddy/Caddyfile",
			"EXPOSE 80",
		].join("\n"),
	);

	command += getDockerCommand({
		...application,
		buildType: "dockerfile",
		dockerfile: "Dockerfile",
	});
	return command;
};
