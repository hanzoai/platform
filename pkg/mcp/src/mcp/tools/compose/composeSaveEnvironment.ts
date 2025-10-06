import { z } from "zod";
import apiClient from "../../../utils/apiClient.js";
import { createTool } from "../toolFactory.js";
import { ResponseFormatter } from "../../../utils/responseFormatter.js";

export const composeSaveEnvironment = createTool({
  name: "compose-saveEnvironment",
  description: "Saves environment variables for a compose service in Platform",
  schema: z.object({
    composeId: z.string().describe("The ID of the compose service"),
    env: z.string().nullable().describe("Environment variables to save"),
  }),
  annotations: {
    title: "Save Compose Environment Variables",
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: async (input) => {
    const result = await apiClient.post("/compose.saveEnvironment", {
      composeId: input.composeId,
      env: input.env
    });

    if (!result?.data) {
      return ResponseFormatter.error(
        "Failed to save environment variables",
        `Could not save environment variables for compose service "${input.composeId}"`
      );
    }

    return ResponseFormatter.success(
      `Successfully saved environment variables for compose service "${input.composeId}"`,
      result.data
    );
  },
});