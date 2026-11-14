export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void
  info(message: string, fields?: Record<string, unknown>): void
  warn(message: string, fields?: Record<string, unknown>): void
  error(message: string, fields?: Record<string, unknown>): void
  child(scope: string): Logger
}

const order: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

/** Logs to stderr, so stdout stays free for the stdio bridge. */
export function createLogger(level: LogLevel = 'info', scope = ''): Logger {
  const write = (at: LogLevel, message: string, fields?: Record<string, unknown>) => {
    if (order[at] < order[level]) return
    const prefix = scope ? `[${scope}] ` : ''
    const extra = fields && Object.keys(fields).length ? ` ${JSON.stringify(fields)}` : ''
    process.stderr.write(`${new Date().toISOString()} ${at.padEnd(5)} ${prefix}${message}${extra}\n`)
  }
  return {
    debug: (m, f) => write('debug', m, f),
    info: (m, f) => write('info', m, f),
    warn: (m, f) => write('warn', m, f),
    error: (m, f) => write('error', m, f),
    child: (s) => createLogger(level, scope ? `${scope}:${s}` : s),
  }
}

export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child: () => silentLogger,
}
