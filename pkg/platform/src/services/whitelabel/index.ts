/**
 * White-label reseller foundation — the service layer that turns the console
 * Tenants / White-Label board's honest-404s into real, data-driven self-service.
 *
 * Everything is DATA: packages, service templates, brands, and domain bindings
 * are rows; provisioning composes the existing platform services and records the
 * honest outcome. Nothing is hardcoded as the canonical path.
 */
export * from "./logic";
export * from "./packages";
export * from "./service-registry";
export * from "./brand";
export * from "./domain";
export * from "./iam-tenant";
export * from "./reseller";
export * from "./provision";
export * from "./seed";
export { SEED_BRANDS, SEED_PACKAGES, SEED_SERVICE_TEMPLATES } from "./seed-data";
