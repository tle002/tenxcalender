import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { Credentials } from "google-auth-library";

// Tokens live in backend/.google-tokens.json (git-ignored) so you stay signed in across restarts.
const FILE = process.env.GOOGLE_TOKEN_FILE ?? fileURLToPath(new URL("../../.google-tokens.json", import.meta.url));

export interface StoredAuth {
  tokens: Credentials;
  email: string;
}

export function readAuth(): StoredAuth | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf8")) as StoredAuth;
    return parsed?.tokens && parsed?.email ? parsed : null;
  } catch {
    return null;
  }
}

export function writeAuth(a: StoredAuth) {
  fs.writeFileSync(FILE, JSON.stringify(a, null, 2), { mode: 0o600 });
}

export function clearAuth() {
  try {
    fs.unlinkSync(FILE);
  } catch {
    /* already gone */
  }
}
