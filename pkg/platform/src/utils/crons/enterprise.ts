/**
 * Enterprise license validation stubs.
 * All enterprise features are available without license gating.
 */

export const LICENSE_KEY_URL = "";

/** No-op: enterprise cron jobs are disabled. */
export const initEnterpriseBackupCronJobs = async () => {
	// All enterprise features are always enabled -- no license validation needed.
};

/** Always returns true -- no license gating. */
export const validateLicenseKey = async (_licenseKey: string) => {
	return true;
};

// hasValidLicense is exported from services/license.ts
