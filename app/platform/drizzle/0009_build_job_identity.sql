-- A build is identified by what it produces: the source it read, the matrix
-- entry it read it for, and the image it publishes. `build_job_identity` states
-- that to the database, so one build is one row no matter how many deliveries
-- of it arrive at once — a read-then-insert in the writer cannot, because two
-- reads can both miss between the read and the insert.
--
-- Rows written before the constraint may name one build more than once. The
-- earliest is the row every reader that did dedupe was handed, so it is the one
-- that stays and the later ones go. They describe the same commit built to the
-- same tag, so nothing that was published is lost with them.
DELETE FROM `build_job` WHERE rowid NOT IN (
	SELECT min(rowid) FROM `build_job` GROUP BY `repo`, `sha`, `target`, `image`
);
--> statement-breakpoint
CREATE UNIQUE INDEX `build_job_identity` ON `build_job` (`repo`,`sha`,`target`,`image`);
