import { z } from "zod";
import apiClient from "../../../utils/apiClient.js";
import { createTool } from "../toolFactory.js";
import { ResponseFormatter } from "../../../utils/responseFormatter.js";

export const composeDeploy = createTool({
  name: "compose-deploy",
  description: "Deploys a compose service in Platform",
  schema: z.object({
    composeId: z.string().describe("The ID of the compose service to deploy"),
  }),
  annotations: {
    title: "Deploy Compose Service",
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  handler: async (input) => {
    const result = await apiClient.post("/compose.deploy", {
      composeId: input.composeId
    });

    if (!result?.data) {
      return ResponseFormatter.error(
        "Failed to deploy compose service",
        `Could not deploy compose service with ID "${input.composeId}"`
      );
    }

    return ResponseFormatter.success(
      `Successfully deployed compose service "${input.composeId}"`,
      result.data
    );
  },
});