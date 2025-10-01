import { boolean, pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { relations } from "drizzle-orm";
import { nanoid } from "nanoid";

// Base server table for multi-server support (simplified for now)
export const server = pgTable("server", {
  id: text("id").primaryKey().$defaultFn(() => nanoid()),
  name: text("name").notNull().default("main"),
  description: text("description"),
  serverId: text("server_id").unique(),
  ipAddress: text("ip_address"),
  port: integer("port").default(3000),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const serverRelations = relations(server, ({ many }) => ({
  // Add relations to other entities here as needed
}));

export const insertServerSchema = createInsertSchema(server);