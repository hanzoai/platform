// Database schema stub
import { pgTable, text, timestamp, boolean, uuid } from "drizzle-orm/pg-core";

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: text("type").notNull(),
  projectId: text("project_id"),
  organizationId: text("organization_id"),
  enabled: boolean("enabled").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  // Notification service specific fields
  email: text("email"),
  discordWebhookUrl: text("discord_webhook_url"),
  slackWebhookUrl: text("slack_webhook_url"),
  telegramBotToken: text("telegram_bot_token"),
  telegramChatId: text("telegram_chat_id"),
  gotifyUrl: text("gotify_url"),
  gotifyToken: text("gotify_token"),
  ntfyUrl: text("ntfy_url"),
  ntfyTopic: text("ntfy_topic"),
});

export default {
  notifications
};