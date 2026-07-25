-- apps.hosts — the public hostnames the operator CR publishes for a workload
-- (`spec.ingress.hosts`), stored as a JSON array of strings.
--
-- The apps board listed what is deployed but gave no way to reach it. The CRs
-- already carry the answer (`ingress.hosts`), so the inventory reader now
-- observes it alongside the tags and health. Nullable: an internal-only
-- workload declares no ingress and legitimately has no host.
ALTER TABLE `apps` ADD `hosts` text;
