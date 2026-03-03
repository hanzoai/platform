export * from "@hanzo/platform/db/schema";

// Add missing validators temporarily
import { z } from "zod";

export const apiFindCompose = z.object({
  composeId: z.string()
});

export const apiFindOneApplication = z.object({
  applicationId: z.string()
});
