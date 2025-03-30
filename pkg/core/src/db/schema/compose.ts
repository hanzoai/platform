// This is a stub file to maintain compatibility with existing imports
// Compose functionality has been removed

import { pgTable, text } from "drizzle-orm/pg-core";

// Create a minimal table definition instead of just null
export const compose = pgTable("compose", {
    composeId: text("composeId"),
    appName: text("appName"),
    serverId: text("serverId"),
});

// Provide empty implementations for other exports that might be used
export const composeRelations = {};
export const apiCreateCompose = {};
export const apiFindCompose = {};
export const apiRemoveCompose = {};
export const apiUpdateCompose = {};
