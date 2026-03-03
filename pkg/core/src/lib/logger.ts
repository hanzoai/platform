import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = isProduction
	? pino()
	: pino({
		transport: {
			target: "pino-pretty",
			options: {
				colorize: true,
				levelFirst: false,
			},
		},
	});
