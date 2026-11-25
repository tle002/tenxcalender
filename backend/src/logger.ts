import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// File logger. Every backend run writes backend/logs/run-<timestamp>.log, and
// backend/logs/latest.log always holds the most recent run. Secrets are redacted.
// Set LOG_TO_FILE=false to disable file output (used by tests).

const LOG_DIR = fileURLToPath(new URL("../logs/", import.meta.url));
const KEEP_RUNS = 20;
const pad = (n: number, w = 2) => String(n).padStart(w, "0");

let runStream: fs.WriteStream | null = null;
let latestStream: fs.WriteStream | null = null;
let runFile = "";

const stamp = (d: Date, sep: string) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}${sep}${pad(d.getHours())}${sep === "_" ? "-" : ":"}${pad(d.getMinutes())}${sep === "_" ? "-" : ":"}${pad(d.getSeconds())}`;

function init() {
  if (runStream || process.env.LOG_TO_FILE === "false") return;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    runFile = path.join(LOG_DIR, `run-${stamp(new Date(), "_")}.log`);
    runStream = fs.createWriteStream(runFile, { flags: "a" });
    latestStream = fs.createWriteStream(path.join(LOG_DIR, "latest.log"), { flags: "w" });
    const old = fs.readdirSync(LOG_DIR).filter((f) => /^run-.*\.log$/.test(f)).sort().slice(0, -KEEP_RUNS);
    for (const f of old) fs.unlinkSync(path.join(LOG_DIR, f));
  } catch (e) {
    console.error("Could not open log file:", e);
  }
}

const SENSITIVE = /(api[-_]?key|secret|token|authorization|password)/i;
function replacer(key: string, v: unknown) {
  if (key && SENSITIVE.test(key)) return "[redacted]";
  if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack };
  if (typeof v === "string" && v.length > 2000) return `${v.slice(0, 2000)}…(+${v.length - 2000} chars)`;
  return v;
}

function write(level: "DEBUG" | "INFO" | "WARN" | "ERROR", msg: string, data?: unknown) {
  init();
  const d = new Date();
  const line = `${stamp(d, " ")}.${pad(d.getMilliseconds(), 3)} ${level.padEnd(5)} ${msg}${data === undefined ? "" : " " + JSON.stringify(data, replacer)}`;
  (level === "ERROR" ? console.error : console.log)(line.length > 400 ? line.slice(0, 400) + " …" : line);
  runStream?.write(line + "\n");
  latestStream?.write(line + "\n");
}

export const log = {
  debug: (m: string, d?: unknown) => write("DEBUG", m, d),
  info: (m: string, d?: unknown) => write("INFO", m, d),
  warn: (m: string, d?: unknown) => write("WARN", m, d),
  error: (m: string, d?: unknown) => write("ERROR", m, d),
};

export const logDir = () => LOG_DIR;
