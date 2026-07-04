/**
 * Seed data for the white-label foundation — the CANONICAL catalog.
 *
 * The `packages` array is byte-for-byte the same catalog as
 * `console/platform-seed/packages.json` (the console's seed source), embedded
 * here because the platform pod cannot read the console repo at runtime. The
 * two must stay in sync; this is the platform-side source that `GET /v1/packages`
 * serves. Adding a package = a row (edit here + the console JSON, reseed).
 *
 * `serviceTemplates` is the data-driven service-name → deploy-template map that
 * makes `provisionPackage` deploy by name. `existingBrands` seeds the current
 * brands (hanzo/lux/zoo/pars) as tenant records so `GET /v1/brand?host=` returns
 * them FROM DATA — they become the first rows, not special-cased code.
 */
import type { NewPackage } from "../../db/schema";

export const SEED_PACKAGES: NewPackage[] = [
	{
		id: "console-admin",
		name: "Console / Admin",
		description:
			"A white-label admin console for the tenant — their own branded control plane over Hanzo Cloud.",
		services: ["console-admin", "iam"],
		brandTemplate: { customBrand: true, hostPattern: "console.{slug}.hanzo.app" },
		iamTemplate: { ownIssuer: false, appPattern: "{slug}-console" },
		domainPattern: "console.{slug}.hanzo.app",
		plan: "starter",
		sovereign: false,
	},
	{
		id: "paas",
		name: "PaaS",
		description:
			"The deploy platform — projects, environments, apps, and pipelines on a dedicated cluster.",
		services: ["paas", "iam", "kms"],
		brandTemplate: { customBrand: false, hostPattern: "{slug}.hanzo.app" },
		iamTemplate: { ownIssuer: false, appPattern: "{slug}-paas" },
		domainPattern: "{slug}.hanzo.app",
		plan: "growth",
		sovereign: false,
	},
	{
		id: "dex",
		name: "DEX",
		description:
			"A decentralized exchange surface, branded and domain-bound for the tenant.",
		services: ["dex", "iam", "kms"],
		brandTemplate: { customBrand: true, hostPattern: "dex.{slug}.exchange" },
		iamTemplate: { ownIssuer: false, appPattern: "{slug}-dex" },
		domainPattern: "dex.{slug}.exchange",
		plan: "growth",
		sovereign: false,
	},
	{
		id: "bank",
		name: "Bank",
		description:
			"The regulated bank / tokenization stack with per-tenant custody and KMS.",
		services: ["bank", "iam", "kms"],
		brandTemplate: { customBrand: true, hostPattern: "bank.{slug}.com" },
		iamTemplate: { ownIssuer: true, appPattern: "{slug}-bank" },
		domainPattern: "bank.{slug}.com",
		plan: "enterprise",
		sovereign: false,
	},
	{
		id: "ats",
		name: "ATS",
		description:
			"An alternative trading system surface with its own IAM scope and secrets.",
		services: ["ats", "iam", "kms"],
		brandTemplate: { customBrand: true, hostPattern: "ats.{slug}.com" },
		iamTemplate: { ownIssuer: true, appPattern: "{slug}-ats" },
		domainPattern: "ats.{slug}.com",
		plan: "enterprise",
		sovereign: false,
	},
	{
		id: "bd",
		name: "Broker-Dealer",
		description:
			"A broker-dealer surface, provisioned with the tenant brand + identity scope.",
		services: ["bd", "iam", "kms"],
		brandTemplate: { customBrand: true, hostPattern: "bd.{slug}.com" },
		iamTemplate: { ownIssuer: true, appPattern: "{slug}-bd" },
		domainPattern: "bd.{slug}.com",
		plan: "enterprise",
		sovereign: false,
	},
	{
		id: "ta",
		name: "Transfer Agent",
		description:
			"A transfer-agent surface for the tenant, branded and identity-scoped.",
		services: ["ta", "iam", "kms"],
		brandTemplate: { customBrand: true, hostPattern: "ta.{slug}.com" },
		iamTemplate: { ownIssuer: true, appPattern: "{slug}-ta" },
		domainPattern: "ta.{slug}.com",
		plan: "enterprise",
		sovereign: false,
	},
	{
		id: "sovereign-l1",
		name: "Sovereign L1",
		description:
			"The full regulated-fintech stack on a sovereign L1 — ATS + BD + TA + the tenant's own chain.",
		services: ["ats", "bd", "ta", "chain", "iam", "kms", "console-admin"],
		brandTemplate: { customBrand: true, hostPattern: "{slug}.network" },
		iamTemplate: { ownIssuer: true, appPattern: "{slug}-console" },
		domainPattern: "{slug}.network",
		plan: "enterprise",
		sovereign: true,
	},
];

/**
 * Service templates — the deploy map. `iam`/`kms` are `deployable:false`
 * (identity/secret scope, not tenant workloads). `console-admin`/`paas` map to
 * their real published images (deploy directly, no build). `dex`/`bank`/`ats`/
 * `bd`/`ta`/`chain` HAVE no published tenant image yet → intentionally OMITTED,
 * so provisionPackage records them `pending` honestly (adding one = a row).
 */
export interface SeedServiceTemplate {
	id: string;
	name: string;
	repo?: string;
	image?: string;
	defaultTag?: string;
	port?: number;
	deployable?: boolean;
	buildRequired?: boolean;
}

export const SEED_SERVICE_TEMPLATES: SeedServiceTemplate[] = [
	{
		id: "console-admin",
		name: "Console / Admin",
		repo: "hanzoai/console",
		image: "ghcr.io/hanzoai/console",
		port: 3000,
		deployable: true,
		buildRequired: false,
	},
	{
		id: "paas",
		name: "PaaS",
		repo: "hanzoai/platform",
		image: "ghcr.io/hanzoai/platform",
		port: 3000,
		deployable: true,
		buildRequired: false,
	},
	// Identity + secrets are scope, not tenant workloads.
	{ id: "iam", name: "IAM", deployable: false, port: 8000 },
	{ id: "kms", name: "KMS", deployable: false, port: 8080 },
];

/** The current brands, as tenant records, so the resolver returns them FROM DATA. */
export interface SeedBrand {
	/** Org slug + IAM org name. */
	slug: string;
	name: string;
	brandName: string;
	iamUrl: string;
	iamApp: string;
	logoUrl?: string;
	accentColor?: string;
	/** Hosts that route to / brand as this org. */
	hosts: string[];
}

export const SEED_BRANDS: SeedBrand[] = [
	{
		slug: "hanzo",
		name: "Hanzo",
		brandName: "Hanzo Cloud",
		iamUrl: "https://hanzo.id",
		iamApp: "hanzo-cloud",
		accentColor: "#000000",
		hosts: ["console.hanzo.ai", "cloud.hanzo.ai", "admin.hanzo.ai"],
	},
	{
		slug: "lux",
		name: "Lux",
		brandName: "Lux Cloud",
		iamUrl: "https://lux.id",
		iamApp: "lux-cloud",
		accentColor: "#0A84FF",
		hosts: ["console.lux.network", "cloud.lux.network", "admin.lux.network"],
	},
	{
		slug: "zoo",
		name: "Zoo",
		brandName: "Zoo Cloud",
		iamUrl: "https://zoolabs.id",
		iamApp: "zoo-cloud",
		accentColor: "#22C55E",
		hosts: ["console.zoo.cloud", "cloud.zoo.ngo", "admin.zoo.cloud"],
	},
	{
		slug: "pars",
		name: "Pars",
		brandName: "Pars Cloud",
		iamUrl: "https://pars.id",
		iamApp: "pars-cloud",
		accentColor: "#8B5CF6",
		hosts: ["console.pars.network", "cloud.pars.network", "admin.pars.network"],
	},
];
