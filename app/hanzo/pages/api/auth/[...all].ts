<<<<<<< HEAD:app/cloud/pages/api/auth/[...all].ts
import { auth } from "@dokploy/server/index";
=======
import { auth } from "@hanzo/core/index";
>>>>>>> 923b06f1 (Add AI, organizations and other updates.):app/hanzo/pages/api/auth/[...all].ts
import { toNodeHandler } from "better-auth/node";

// Disallow body parsing, we will parse it manually
export const config = { api: { bodyParser: false } };

export default toNodeHandler(auth.handler);
