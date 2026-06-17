# notification.zap — Notification provider capability.
#
# Native ZAP schema replacing the browser-facing half of the tRPC
# `notificationRouter` (server/api/routers/notification.ts). Methods cover
# per-provider create/update/test-connection for slack, telegram, discord,
# email, resend, gotify, ntfy, mattermost, custom, lark, teams, pushover, plus
# list (all), read (one), delete (remove), and the email-provider listing
# (getEmailProviders). Every method here was a session-gated `withPermission`
# procedure, so the mint boundary requires session+user (HTTP 401 on null).
#
# The router's `receiveNotification` procedure is intentionally NOT migrated: it
# is a PUBLIC server-to-server webhook (remote monitoring agents POST to
# `/api/trpc/notification.receiveNotification` with a body-carried token, NOT a
# browser session). It stays a tRPC HTTP endpoint; moving it onto this
# session-minted WS would break remote metrics callbacks.
#
# Inputs are Drizzle-derived Zod schemas (apiCreate*/apiUpdate*/apiTest*Connection,
# apiFindOneNotification) carried via the shared Args struct (../args.ts); return
# values via the shared Result struct (../result.ts). This schema declares only
# the method ordinals — request/response payloads ride the generic carriers.
# Compiled by `zapgen schema/notification.zap -out schema/`.

package notification

# Args/Result are the shared carriers (schema/args.zap, schema/result.zap).
# Methods reference them by name; the generic struct codecs come from those
# generated modules, not from this file.

interface Notification {
  createSlack(args: Args) returns (result: Result)
  updateSlack(args: Args) returns (result: Result)
  testSlackConnection(args: Args) returns (result: Result)
  createTelegram(args: Args) returns (result: Result)
  updateTelegram(args: Args) returns (result: Result)
  testTelegramConnection(args: Args) returns (result: Result)
  createDiscord(args: Args) returns (result: Result)
  updateDiscord(args: Args) returns (result: Result)
  testDiscordConnection(args: Args) returns (result: Result)
  createEmail(args: Args) returns (result: Result)
  updateEmail(args: Args) returns (result: Result)
  testEmailConnection(args: Args) returns (result: Result)
  createResend(args: Args) returns (result: Result)
  updateResend(args: Args) returns (result: Result)
  testResendConnection(args: Args) returns (result: Result)
  remove(args: Args) returns (result: Result)
  one(args: Args) returns (result: Result)
  all(args: Args) returns (result: Result)
  createGotify(args: Args) returns (result: Result)
  updateGotify(args: Args) returns (result: Result)
  testGotifyConnection(args: Args) returns (result: Result)
  createNtfy(args: Args) returns (result: Result)
  updateNtfy(args: Args) returns (result: Result)
  testNtfyConnection(args: Args) returns (result: Result)
  createMattermost(args: Args) returns (result: Result)
  updateMattermost(args: Args) returns (result: Result)
  testMattermostConnection(args: Args) returns (result: Result)
  createCustom(args: Args) returns (result: Result)
  updateCustom(args: Args) returns (result: Result)
  testCustomConnection(args: Args) returns (result: Result)
  createLark(args: Args) returns (result: Result)
  updateLark(args: Args) returns (result: Result)
  testLarkConnection(args: Args) returns (result: Result)
  createTeams(args: Args) returns (result: Result)
  updateTeams(args: Args) returns (result: Result)
  testTeamsConnection(args: Args) returns (result: Result)
  createPushover(args: Args) returns (result: Result)
  updatePushover(args: Args) returns (result: Result)
  testPushoverConnection(args: Args) returns (result: Result)
  getEmailProviders(args: Args) returns (result: Result)
}
