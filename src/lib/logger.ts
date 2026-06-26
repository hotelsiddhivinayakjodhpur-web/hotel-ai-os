import { env } from "./env";

/**
 * Tiny structured logger. JSON lines so Vercel/Supabase log drains can parse
 * them. Every Stayflexi API call goes through here (see http.ts) for an audit
 * trail — but secrets are NEVER logged (the http layer redacts headers).
 */
type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = ORDER[env.LOG_LEVEL];

function emit(level: Level, msg: string, meta?: Record<string, unknown>) {
  if (ORDER[level] < threshold) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(meta ? { meta } : {}),
  };
  const out = JSON.stringify(line);
  if (level === "error") console.error(out);
  else if (level === "warn") console.warn(out);
  else console.log(out);
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => emit("debug", msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => emit("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit("error", msg, meta),

  /** Child logger that stamps every line with a fixed context (e.g. {agent}). */
  child(context: Record<string, unknown>) {
    return {
      debug: (m: string, x?: Record<string, unknown>) => emit("debug", m, { ...context, ...x }),
      info: (m: string, x?: Record<string, unknown>) => emit("info", m, { ...context, ...x }),
      warn: (m: string, x?: Record<string, unknown>) => emit("warn", m, { ...context, ...x }),
      error: (m: string, x?: Record<string, unknown>) => emit("error", m, { ...context, ...x }),
    };
  },
};

export type Logger = typeof logger;
