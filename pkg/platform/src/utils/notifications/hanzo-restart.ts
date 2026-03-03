import { db } from "@hanzo/platform/db";
import { notifications } from "@hanzo/platform/db/schema";
import HanzoRestartEmail from "@hanzo/platform/emails/emails/hanzo-restart";
import { renderAsync } from "@react-email/components";
import { format } from "date-fns";
import { eq } from "drizzle-orm";
import {
	sendDiscordNotification,
	sendEmailNotification,
	sendGotifyNotification,
	sendSlackNotification,
	sendTelegramNotification,
} from "./utils";

export const sendHanzoRestartNotifications = async () => {
	const date = new Date();
	const unixDate = ~~(Number(date) / 1000);
	const notificationList = await db.query.notifications.findMany({
		where: eq(notifications.hanzoRestart, true),
		with: {
			email: true,
			discord: true,
			telegram: true,
			slack: true,
			gotify: true,
		},
	});

	for (const notification of notificationList) {
		const { email, discord, telegram, slack, gotify } = notification;

		if (email) {
			const template = await renderAsync(
				HanzoRestartEmail({ date: date.toLocaleString() }),
			).catch();
			await sendEmailNotification(email, "Hanzo Server Restarted", template);
		}

		if (discord) {
			const decorate = (decoration: string, text: string) =>
				`${discord.decoration ? decoration : ""} ${text}`.trim();

			await sendDiscordNotification(discord, {
				title: decorate(">", "`✅` Hanzo Server Restarted"),
				color: 0x57f287,
				fields: [
					{
						name: decorate("`📅`", "Date"),
						value: `<t:${unixDate}:D>`,
						inline: true,
					},
					{
						name: decorate("`⌚`", "Time"),
						value: `<t:${unixDate}:t>`,
						inline: true,
					},
					{
						name: decorate("`❓`", "Type"),
						value: "Successful",
						inline: true,
					},
				],
				timestamp: date.toISOString(),
				footer: {
					text: "Hanzo Restart Notification",
				},
			});
		}

		if (gotify) {
			const decorate = (decoration: string, text: string) =>
				`${gotify.decoration ? decoration : ""} ${text}\n`;
			await sendGotifyNotification(
				gotify,
				decorate("✅", "Hanzo Server Restarted"),
				`${decorate("🕒", `Date: ${date.toLocaleString()}`)}`,
			);
		}

		if (telegram) {
			await sendTelegramNotification(
				telegram,
				`<b>✅ Hanzo Server Restarted</b>\n\n<b>Date:</b> ${format(date, "PP")}\n<b>Time:</b> ${format(date, "pp")}`,
			);
		}

		if (slack) {
			const { channel } = slack;
			await sendSlackNotification(slack, {
				channel: channel,
				attachments: [
					{
						color: "#00FF00",
						pretext: ":white_check_mark: *Hanzo Server Restarted*",
						fields: [
							{
								title: "Time",
								value: date.toLocaleString(),
								short: true,
							},
						],
					},
				],
			});
		}
	}
};
