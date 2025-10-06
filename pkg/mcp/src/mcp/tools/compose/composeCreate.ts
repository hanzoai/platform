import { z } from "zod";
import apiClient from "../../../utils/apiClient.js";
import { createTool } from "../toolFactory.js";
import { ResponseFormatter } from "../../../utils/responseFormatter.js";

export const composeCreate = createTool({
  name: "compose-create",
  description: "Creates a new compose service in Platform",
  schema: z.object({
    name: z.string().describe("The name of the compose service"),
    appName: z.string().optional().describe("Optional application name"),
    description: z.string().nullable().describe("Description of the compose service"),
    projectId: z.string().describe("The ID of the project"),
    serverId: z.string().nullable().describe("The ID of the server"),
    composeFile: z.string().optional().describe("Docker Compose file content"),
    env: z.string().nullable().describe("Environment variables"),
    composeType: z.enum(["docker-compose", "stack"]).default("docker-compose").describe("Type of compose service"),
  }),
  annotations: {
    title: "Create Compose Service",
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  handler: async (input) => {
    const compose = await apiClient.post("/compose.create", input);

    if (!compose?.data) {
      return ResponseFormatter.error(
        "Failed to create compose service",
        "Could not create the compose service"
      );
    }

    return ResponseFormatter.success(
      `Successfully created compose service "${input.name}"`,
      compose.data
    );
  },
});