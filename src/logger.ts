/**
 * Forge MCP — Structured JSON Logger
 *
 * Zero-dependency structured logger that writes JSON to stderr.
 * Keeps stdout clean for MCP stdio transport.
 */

// ─── Log Levels ─────────────────────────────────────────────────────

export const LogLevel = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
} as const;

export type LogLevelName = keyof typeof LogLevel;

// ─── Helpers ─────────────────────────────────────────────────────────

function getLevelFromEnv(): number {
  if (process.env.FORGE_LOG_LEVEL) {
    const envLevel = process.env.FORGE_LOG_LEVEL.toUpperCase() as LogLevelName;
    if (envLevel in LogLevel) {
      return LogLevel[envLevel];
    }
  }
  // Default to INFO in production, DEBUG otherwise
  if (process.env.NODE_ENV === "production") {
    return LogLevel.INFO;
  }
  return LogLevel.DEBUG;
}

function isoNow(): string {
  return new Date().toISOString();
}

function formatMeta(meta?: Record<string, unknown>): Record<string, unknown> {
  return meta ?? {};
}

// ─── Logger ──────────────────────────────────────────────────────────

export interface LoggerEntry {
  ts: string;
  level: LogLevelName;
  msg: string;
  [key: string]: unknown;
}

export class ForgeLogger {
  private readonly minLevel: number;
  private readonly baseMeta: Record<string, unknown>;

  constructor(minLevel?: number, baseMeta?: Record<string, unknown>) {
    this.minLevel = minLevel ?? getLevelFromEnv();
    this.baseMeta = { service: "forge-mcp", ...(baseMeta ?? {}) };
  }

  /** Create a child logger with additional metadata merged in. */
  child(extraMeta: Record<string, unknown>): ForgeLogger {
    return new ForgeLogger(this.minLevel, {
      ...this.baseMeta,
      ...extraMeta,
    });
  }

  debug(msg: string, meta?: Record<string, unknown>): void {
    this.write("DEBUG", msg, meta);
  }

  info(msg: string, meta?: Record<string, unknown>): void {
    this.write("INFO", msg, meta);
  }

  warn(msg: string, meta?: Record<string, unknown>): void {
    this.write("WARN", msg, meta);
  }

  error(msg: string, meta?: Record<string, unknown>): void {
    this.write("ERROR", msg, meta);
  }

  private write(level: LogLevelName, msg: string, meta?: Record<string, unknown>): void {
    if (LogLevel[level] < this.minLevel) {
      return;
    }

    const entry: LoggerEntry = {
      ts: isoNow(),
      level,
      msg,
      ...this.baseMeta,
      ...formatMeta(meta),
    };

    // Write to stderr as a single JSON line
    // Use process.stderr.write to avoid console.error's own formatting
    process.stderr.write(JSON.stringify(entry) + "\n");
  }
}

// ─── Default Singleton ───────────────────────────────────────────────

const defaultLogger = new ForgeLogger();
export default defaultLogger;
