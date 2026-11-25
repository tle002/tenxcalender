import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./logger.js";

// Tiny JSON-file store for the only state the app owns (rules, history).
// Events live in the calendar itself, so there is no database.
export const dataDir = () => process.env.DATA_DIR ?? fileURLToPath(new URL("../data/", import.meta.url));

export function readJson<T>(name: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir(), name), "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(name: string, value: unknown) {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.writeFileSync(path.join(dataDir(), name), JSON.stringify(value, null, 2));
  } catch (err) {
    log.warn("could not write data file", { name, message: (err as Error).message });
  }
}
