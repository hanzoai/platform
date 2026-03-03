import fs from "node:fs/promises";
import path from "node:path";
import type { ApplicationNested } from "@hanzo/core";
import { unzipDrop } from "@hanzo/core";
import { paths } from "@hanzo/core/constants";
import AdmZip from "adm-zip";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { APPLICATIONS_PATH } = paths();

vi.mock("@hanzo/core/constants", async (importOriginal) => {
	const actual = await importOriginal();
	return {
		// @ts-ignore
		...actual,
		paths: () => ({
			APPLICATIONS_PATH: "./__test__/drop/zips/output",
		}),
	};
});

if (typeof window === "undefined") {
	const undici = require("undici");
	globalThis.File = undici.File as any;
	globalThis.FileList = undici.FileList as any;
}

const baseApp: ApplicationNested = {
	railpackVersion: "0.2.2",
	applicationId: "",
	previewLabels: [],
	herokuVersion: "",
	giteaBranch: "",
	giteaBuildPath: "",
	previewRequireCollaboratorPermissions: false,
	giteaId: "",
	giteaOwner: "",
	giteaRepository: "",
	gitUrl: "",
	createdAt: "",
	serverId: null,
	name: "backend-drop",
	environmentId: "",
	autoDeploy: false,
	refreshToken: "",
	sourceType: "drop",
	repository: null,
	owner: null,
	branch: null,
	buildPath: "/",
	gitlabProjectId: 0,
	gitlabRepository: null,
	gitlabOwner: null,
	gitlabBranch: null,
	gitlabBuildPath: null,
	gitlabPathNamespace: null,
	bitbucketRepository: null,
	bitbucketOwner: null,
	bitbucketBranch: null,
	bitbucketBuildPath: null,
	customGitUrl: null,
	customGitBranch: null,
	customGitBuildPath: null,
	customGitSSHKeyId: null,
	dockerfile: null,
	buildArgs: null,
	customBuildCommand: null,
	customRunCommand: null,
	customStartCommand: null,
	installCommand: null,
	buildCommand: null,
	startCommand: null,
	memoryReservation: null,
	memoryLimit: null,
	cpuReservation: null,
	cpuLimit: null,
	title: null,
	enabled: false,
	subtitle: null,
	dockerImage: null,
	command: null,
	env: null,
	replicas: 1,
	mounts: [],
	ports: [],
	volumes: [],
	redirects: [],
	security: [],
	github: null,
	gitlab: null,
	bitbucket: null,
	git: null,
	gitea: null,
	registry: null,
	domains: [],
	deployments: [],
	project: {
		servers: [],
		projectId: "project123",
		name: "My Project",
		environmentId: "environment123",
	},
	previewPath: null,
	previewCertificateType: "none",
	previewCustomCertResolver: null,
	previewHttps: false,
	previewPort: null,
	previewWildcard: "",
	// drop specific fields
	dropBuildPath: "/",
	composePath: "",
	composeStatus: "",
	projectPath: "",
	cpuArchitecture: "arm64",
	tmpVolumeSize: "1gb",
	logRunId: "",
	buildType: "nixpacks",
	previewEnv: "",
	healthCheckSwarm: "",
	restartPolicySwarm: "",
	restartPolicyCompose: "",
	placementConstraints: "",
	updateConfigSwarm: "",
	rollbackConfigSwarm: "",
	modeSwarm: "",
	labelsSwarm: "",
	labelsCompose: "",
	previewDeployments: [],
	cpuReservationCompose: null,
	cpuLimitCompose: null,
	memoryReservationCompose: null,
	memoryLimitCompose: null,
	networkSwarm: null,
	logMaxSizeCompose: "10mb",
	logMaxFilesCompose: 1,
	environment: {
		environmentId: "environment123",
		name: "production",
		description: null,
		env: null,
		createdAt: "",
		projectId: "",
		users: [],
	},
	description: null,
	dockerContext: null,
	publishDirectory: null,
	previewLabelsSwarm: "",
	previewLabelsCompose: "",
};

const testDir = "./__test__/drop/zips";

describe("unzipDrop", () => {
	beforeAll(async () => {
		await fs.mkdir(path.join(testDir, "output"), { recursive: true });
	});

	afterAll(async () => {
		await fs.rm(path.join(testDir, "output"), { recursive: true });
	});

	it("should unzip a Vite build file correctly", async () => {
		const zipPath = path.join(testDir, "vite-build.zip");
		const zipFile = await fs.readFile(zipPath);

		const result = await unzipDrop(
			baseApp,
			new File([zipFile], "vite-build.zip"),
		);

		expect(result).toBeTruthy();

		const appDir = path.join(
			APPLICATIONS_PATH,
			baseApp.applicationId,
			"code",
		);
		const outputFiles = await fs.readdir(appDir);

		expect(outputFiles).toContain("index.html");
		expect(outputFiles).toContain("favicon.ico");
	});

	it("should validate zip contains an index.html file", async () => {
		const zip = new AdmZip();
		zip.addFile("test.txt", Buffer.from("test content"));

		const zipBuffer = zip.toBuffer();

		await expect(
			unzipDrop(baseApp, new File([zipBuffer], "test.zip")),
		).rejects.toThrow("No index.html file found");
	});

	it("should extract from root if only one directory exists", async () => {
		const zipPath = path.join(testDir, "vite-nested-build.zip");
		const zipFile = await fs.readFile(zipPath);

		const result = await unzipDrop(
			baseApp,
			new File([zipFile], "vite-nested-build.zip"),
		);

		expect(result).toBeTruthy();

		const appDir = path.join(
			APPLICATIONS_PATH,
			baseApp.applicationId,
			"code",
		);
		const outputFiles = await fs.readdir(appDir);

		expect(outputFiles).toContain("index.html");
		expect(outputFiles).toContain("favicon.ico");
		expect(outputFiles).not.toContain("dist");
	});

	it("should reject zip files larger than 50MB", async () => {
		const largeBuffer = Buffer.alloc(51 * 1024 * 1024); // 51MB
		const largeFile = new File([largeBuffer], "large.zip");

		await expect(unzipDrop(baseApp, largeFile)).rejects.toThrow(
			"File size exceeds 50MB limit",
		);
	});

	it("should handle Next.js builds correctly", async () => {
		const zipPath = path.join(testDir, "nextjs-build.zip");
		const zipFile = await fs.readFile(zipPath);

		const result = await unzipDrop(
			baseApp,
			new File([zipFile], "nextjs-build.zip"),
		);

		expect(result).toBeTruthy();

		const appDir = path.join(
			APPLICATIONS_PATH,
			baseApp.applicationId,
			"code",
		);
		const outputFiles = await fs.readdir(appDir);

		expect(outputFiles).toContain("404.html");
		expect(outputFiles).toContain("favicon.ico");
		expect(outputFiles).toContain("_next");
	});

	it("should handle React builds correctly", async () => {
		const zipPath = path.join(testDir, "react-build.zip");
		const zipFile = await fs.readFile(zipPath);

		const result = await unzipDrop(
			baseApp,
			new File([zipFile], "react-build.zip"),
		);

		expect(result).toBeTruthy();

		const appDir = path.join(
			APPLICATIONS_PATH,
			baseApp.applicationId,
			"code",
		);
		const outputFiles = await fs.readdir(appDir);

		expect(outputFiles).toContain("index.html");
		expect(outputFiles).toContain("static");
		expect(outputFiles).toContain("favicon.ico");
	});
});