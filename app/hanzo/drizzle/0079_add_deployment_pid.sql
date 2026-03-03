-- Add PID column to deployment table for process tracking
ALTER TABLE "deployment" ADD COLUMN "pid" integer;