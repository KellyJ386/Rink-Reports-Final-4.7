import 'server-only'

/**
 * Structured server-side logger. Emits JSON lines to stdout — Vercel + Axiom
 * pick these up automatically. Enriches with common fields (action, facility_id,
 * user_id, duration_ms, outcome) when provided.
 *
 * For richer structure later, swap the `emit` function for Winston / pino.
 * Keep the log() signature stable — every caller imports from here.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

type LogFields = {
  action?: string
  facility_id?: string
  user_id?: string
  duration_ms?: number
  outcome?: 'ok' | 'error'
  error?: unknown
  [key: string]: unknown
}

function emit(level: LogLevel, message: string, fields: LogFields = {}): void {
  const row = {
    ts: new Date().toISOString(),
    level,
    message,
    ...fields,
    ...(fields.error instanceof Error
      ? {
          error: {
            name: fields.error.name,
            message: fields.error.message,
            stack: fields.error.stack,
          },
        }
      : {}),
  }
  if (level === 'error') console.error(JSON.stringify(row))
  else if (level === 'warn') console.warn(JSON.stringify(row))
  else console.log(JSON.stringify(row))
}

export const logger = {
  debug: (message: string, fields?: LogFields) => emit('debug', message, fields),
  info: (message: string, fields?: LogFields) => emit('info', message, fields),
  warn: (message: string, fields?: LogFields) => emit('warn', message, fields),
  error: (message: string, fields?: LogFields) => emit('error', message, fields),
}

/**
 * Wrap a server action with timing + structured logging. Usage:
 *
 *   export const submitForm = withLogging('submitForm', async (input) => { ... })
 */
export function withLogging<Args extends unknown[], Result>(
  action: string,
  fn: (...args: Args) => Promise<Result>,
): (...args: Args) => Promise<Result> {
  return async (...args: Args): Promise<Result> => {
    const started = Date.now()
    try {
      const result = await fn(...args)
      logger.info(`action.${action}`, {
        action,
        duration_ms: Date.now() - started,
        outcome: 'ok',
      })
      return result
    } catch (err) {
      logger.error(`action.${action} failed`, {
        action,
        duration_ms: Date.now() - started,
        outcome: 'error',
        error: err,
      })
      throw err
    }
  }
}
