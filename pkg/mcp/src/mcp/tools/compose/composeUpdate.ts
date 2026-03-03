import { z } from "zod";
import apiClient from "../../../utils/apiClient.js";
import { createTool } from "../toolFactory.js";
import { ResponseFormatter } from "../../../utils/responseFormatter.js";

export const composeUpdate = createTool({
  name: "compose-update",
  description: "Updates an existing compose service in Platform",
  schema: z.object({
    composeId: z.string().describe("The ID of the compose service"),
    name: z.string().optional().describe("New name for the compose service"),
    appName: z.string().optional().describe("New application name"),
    description: z.string().nullable().optional().describe("New description"),
    env: z.string().nullable().optional().describe("New environment variables"),
    composeFile: z.string().optional().describe("New Docker Compose file content"),
    sourceType: z.enum(["git", "github", "gitlab", "bitbucket", "raw"]).optional().describe("Source type"),
    composeType: z.enum(["docker-compose", "stack"]).optional().describe("Compose type"),
    serverId: z.string().nullable().optional().describe("New server ID"),
    composeStatus: z.enum(["idle", "running", "done", "error"]).optional().describe("Compose status"),
    projectId: z.string().optional().describe("New project ID"),
  }),
  annotations: {
    title: "Update Compose Service",
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: async (input) => {
    const compose = await apiClient.post("/compose.update", input);

    if (!compose?.data) {
      return ResponseFormatter.error(
        "Failed to update compose service",
        `Could not update compose service with ID "${input.composeId}"`
      );
    }

    return ResponseFormatter.success(
      `Successfully updated compose service "${input.composeId}"`,
      compose.data
    );
  },
});