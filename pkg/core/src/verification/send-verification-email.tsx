import {
	sendDiscordNotification,
	sendEmailNotification,
} from "../utils/notifications/utils";
export const sendEmail = async ({
	email,
	subject,
	text,
}: {
	email: string;
	subject: string;
	text: string;
}) => {
	await sendEmailNotification(
		{
			fromAddress: process.env.SMTP_FROM_ADDRESS || "",
			toAddresses: [email],
			smtpServer: process.env.SMTP_SERVER || "",
			smtpPort: Number(process.env.SMTP_PORT),
			username: process.env.SMTP_USERNAME || "",
			password: process.env.SMTP_PASSWORD || "",
		},
		subject,
		text,
	);

	return true;
};

export const sendDiscordNotificationWelcome = async (email: string) => {
	await sendDiscordNotification(
		{
			webhookUrl: process.env.DISCORD_WEBHOOK_URL || "",
		},
		{
			title: "New User Registered",
			color: 0x00ff00,
			fields: [
				{
					name: "Email",
					value: email,
					inline: true,
				},
			],
			timestamp: new Date(),
			footer: {
<<<<<<< HEAD:pkg/platform/src/verification/send-verification-email.tsx
				text: "Dokploy User Registration Notification",
=======
				text: "Hanzo User Registration Notification",
>>>>>>> 923b06f1 (Add AI, organizations and other updates.):pkg/core/src/verification/send-verification-email.tsx
			},
		},
	);
};
