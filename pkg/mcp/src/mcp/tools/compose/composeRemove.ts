import { z } from "zod";
import apiClient from "../../../utils/apiClient.js";
import { createTool } from "../toolFactory.js";
import { ResponseFormatter } from "../../../utils/responseFormatter.js";

export const composeRemove = createTool({
  name: "compose-remove",
  description: "Removes/deletes a compose service from Platform",
  schema: z.object({
    composeId: z.string().describe("The ID of the compose service to remove"),
  }),
  annotations: {
    title: "Remove Compose Service",
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  handler: async (input) => {
    const result = await apiClient.post("/compose.remove", {
      composeId: input.composeId
    });

    if (!result?.data) {
      return ResponseFormatter.error(
        "Failed to remove compose service",
        `Could not remove compose service with ID "${input.composeId}"`
      );
    }

    return ResponseFormatter.success(
      `Successfully removed compose service "${input.composeId}"`,
      result.data
    );
  },
});