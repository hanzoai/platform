import { z } from "zod";
import apiClient from "../../../utils/apiClient.js";
import { createTool } from "../toolFactory.js";
import { ResponseFormatter } from "../../../utils/responseFormatter.js";

export const composeStart = createTool({
  name: "compose-start",
  description: "Starts a compose service in Platform",
  schema: z.object({
    composeId: z.string().describe("The ID of the compose service to start"),
  }),
  annotations: {
    title: "Start Compose Service",
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  handler: async (input) => {
    const result = await apiClient.post("/compose.start", {
      composeId: input.composeId
    });

    if (!result?.data) {
      return ResponseFormatter.error(
        "Failed to start compose service",
        `Could not start compose service with ID "${input.composeId}"`
      );
    }

    return ResponseFormatter.success(
      `Successfully started compose service "${input.composeId}"`,
      result.data
    );
  },
});