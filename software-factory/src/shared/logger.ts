import type { Clock } from "./types.js";

export type LogLevel = "info" | "warn" | "error";

export type Logger = {
  info: (event: string, fields?: Record<string, unknown>) => void;
  warn: (event: string, fields?: Record<string, unknown>) => void;
  error: (event: string, fields?: Record<string, unknown>) => void;
};

export type LoggerOptions = {
  service: string;
  clock?: Clock;
  write?: (line: string) => void;
};

export const createLogger = (options: LoggerOptions): Logger => {
  const clock = options.clock ?? (() => new Date());
  const write = options.write ?? ((line: string) => console.log(line));

  const log = (
    level: LogLevel,
    event: string,
    fields?: Record<string, unknown>
  ): void => {
    const entry = {
      timestamp: clock().toISOString(),
      level,
      service: options.service,
      event,
      ...fields,
    };
    write(JSON.stringify(entry));
  };

  return {
    info: (event, fields) => log("info", event, fields),
    warn: (event, fields) => log("warn", event, fields),
    error: (event, fields) => log("error", event, fields),
  };
};
