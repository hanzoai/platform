import { z } from "zod";
import apiClient from "../../../utils/apiClient.js";
import { createTool } from "../toolFactory.js";
import { ResponseFormatter } from "../../../utils/responseFormatter.js";

export const composeStop = createTool({
  name: "compose-stop",
  description: "Stops a compose service in Platform",
  schema: z.object({
    composeId: z.string().describe("The ID of the compose service to stop"),
  }),
  annotations: {
    title: "Stop Compose Service",
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: async (input) => {
    const result = await apiClient.post("/compose.stop", {
      composeId: input.composeId
    });

    if (!result?.data) {
      return ResponseFormatter.error(
        "Failed to stop compose service",
        `Could not stop compose service with ID "${input.composeId}"`
      );
    }

    return ResponseFormatter.success(
      `Successfully stopped compose service "${input.composeId}"`,
      result.data
    );
  },
});