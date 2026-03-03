import { z } from "zod";
import apiClient from "../../../utils/apiClient.js";
import { createTool } from "../toolFactory.js";
import { ResponseFormatter } from "../../../utils/responseFormatter.js";

export const composeReload = createTool({
  name: "compose-reload",
  description: "Reloads a compose service in Platform",
  schema: z.object({
    composeId: z.string().describe("The ID of the compose service to reload"),
    appName: z.string().describe("The application name"),
  }),
  annotations: {
    title: "Reload Compose Service",
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  handler: async (input) => {
    const result = await apiClient.post("/compose.reload", {
      composeId: input.composeId,
      appName: input.appName
    });

    if (!result?.data) {
      return ResponseFormatter.error(
        "Failed to reload compose service",
        `Could not reload compose service with ID "${input.composeId}"`
      );
    }

    return ResponseFormatter.success(
      `Successfully reloaded compose service "${input.composeId}"`,
      result.data
    );
  },
});