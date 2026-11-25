import { google } from "googleapis";
import { config } from "../config.js";

// Matches the scopes added on the OAuth consent screen.
export const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
];

export const googleConfigured = () => Boolean(config.google.clientId && config.google.clientSecret);

export function newOAuthClient() {
  return new google.auth.OAuth2(config.google.clientId, config.google.clientSecret, config.google.redirectUri);
}
