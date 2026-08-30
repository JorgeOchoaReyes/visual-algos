import { app } from "electron";
import { appendFileSync, existsSync, renameSync, statSync } from "fs";
import { join } from "path";

/**
 * Tiny structured logger. Writes timestamped lines to the console AND to a
 * persistent file under userData (visuals.log), so when something goes wrong
 * there's an actual trail to read — surfaced via the "Open logs" button in
 * Settings. Rotates once past ~2 MB.
 */

let cached: string | null = null;

export function logFilePath(): string {
  if (cached) return cached;
  const p = join(app.getPath("userData"), "visuals.log");
  try {
    if (existsSync(p) && statSync(p).size > 2_000_000) renameSync(p, `${p}.1`);
  } catch {
    /* ignore rotation errors */
  }
  cached = p;
  return p;
}

function fmt(v: unknown): string {
  if (v === undefined) return "";
  if (v instanceof Error) return ` ${v.stack || v.message}`;
  if (typeof v === "string") return ` ${v}`;
  try {
    return ` ${JSON.stringify(v)}`;
  } catch {
    return ` ${String(v)}`;
  }
}

function write(level: "INFO" | "WARN" | "ERROR", scope: string, msg: string, extra?: unknown): void {
  const line = `${new Date().toISOString()} ${level.padEnd(5)} [${scope}] ${msg}${fmt(extra)}`;
  (level === "ERROR" ? console.error : level === "WARN" ? console.warn : console.log)(line);
  try {
    appendFileSync(logFilePath(), line + "\n");
  } catch {
    /* file logging is best-effort */
  }
}

export const log = {
  info: (scope: string, msg: string, extra?: unknown) => write("INFO", scope, msg, extra),
  warn: (scope: string, msg: string, extra?: unknown) => write("WARN", scope, msg, extra),
  error: (scope: string, msg: string, extra?: unknown) => write("ERROR", scope, msg, extra),
};
