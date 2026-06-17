/**
 * utils/zap-notification.ts — native ZAP RPC client (browser) for the
 * Notification capability. Replaces the browser-facing tRPC `api.notification.*`
 * surface.
 *
 * Opens a single WebSocket to `/zap/notification` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated NotificationMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes per-query
 * invalidation, mirroring tRPC's api.useUtils().
 *
 * Note: the router's public `receiveNotification` webhook is NOT here — it
 * remains a tRPC HTTP endpoint (`api.notification.receiveNotification`) for
 * server-to-server metrics callbacks.
 */

import { encodeArgs } from "@/server/zap/args";
import { NotificationMethod } from "@/server/zap/schema/notification_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/notification");

// Every Notification method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const one = rpc.query(NotificationMethod.one, "one", args);
const all = rpc.query(NotificationMethod.all, "all", args);
const getEmailProviders = rpc.query(
	NotificationMethod.getEmailProviders,
	"getEmailProviders",
	args,
);

export const notification = {
	createSlack: rpc.mutation(NotificationMethod.createSlack, args),
	updateSlack: rpc.mutation(NotificationMethod.updateSlack, args),
	testSlackConnection: rpc.mutation(
		NotificationMethod.testSlackConnection,
		args,
	),
	createTelegram: rpc.mutation(NotificationMethod.createTelegram, args),
	updateTelegram: rpc.mutation(NotificationMethod.updateTelegram, args),
	testTelegramConnection: rpc.mutation(
		NotificationMethod.testTelegramConnection,
		args,
	),
	createDiscord: rpc.mutation(NotificationMethod.createDiscord, args),
	updateDiscord: rpc.mutation(NotificationMethod.updateDiscord, args),
	testDiscordConnection: rpc.mutation(
		NotificationMethod.testDiscordConnection,
		args,
	),
	createEmail: rpc.mutation(NotificationMethod.createEmail, args),
	updateEmail: rpc.mutation(NotificationMethod.updateEmail, args),
	testEmailConnection: rpc.mutation(
		NotificationMethod.testEmailConnection,
		args,
	),
	createResend: rpc.mutation(NotificationMethod.createResend, args),
	updateResend: rpc.mutation(NotificationMethod.updateResend, args),
	testResendConnection: rpc.mutation(
		NotificationMethod.testResendConnection,
		args,
	),
	remove: rpc.mutation(NotificationMethod.remove, args),
	one,
	all,
	createGotify: rpc.mutation(NotificationMethod.createGotify, args),
	updateGotify: rpc.mutation(NotificationMethod.updateGotify, args),
	testGotifyConnection: rpc.mutation(
		NotificationMethod.testGotifyConnection,
		args,
	),
	createNtfy: rpc.mutation(NotificationMethod.createNtfy, args),
	updateNtfy: rpc.mutation(NotificationMethod.updateNtfy, args),
	testNtfyConnection: rpc.mutation(NotificationMethod.testNtfyConnection, args),
	createMattermost: rpc.mutation(NotificationMethod.createMattermost, args),
	updateMattermost: rpc.mutation(NotificationMethod.updateMattermost, args),
	testMattermostConnection: rpc.mutation(
		NotificationMethod.testMattermostConnection,
		args,
	),
	createCustom: rpc.mutation(NotificationMethod.createCustom, args),
	updateCustom: rpc.mutation(NotificationMethod.updateCustom, args),
	testCustomConnection: rpc.mutation(
		NotificationMethod.testCustomConnection,
		args,
	),
	createLark: rpc.mutation(NotificationMethod.createLark, args),
	updateLark: rpc.mutation(NotificationMethod.updateLark, args),
	testLarkConnection: rpc.mutation(NotificationMethod.testLarkConnection, args),
	createTeams: rpc.mutation(NotificationMethod.createTeams, args),
	updateTeams: rpc.mutation(NotificationMethod.updateTeams, args),
	testTeamsConnection: rpc.mutation(
		NotificationMethod.testTeamsConnection,
		args,
	),
	createPushover: rpc.mutation(NotificationMethod.createPushover, args),
	updatePushover: rpc.mutation(NotificationMethod.updatePushover, args),
	testPushoverConnection: rpc.mutation(
		NotificationMethod.testPushoverConnection,
		args,
	),
	getEmailProviders,
	useUtils: makeUseUtils({ one, all, getEmailProviders }),
} as const;
