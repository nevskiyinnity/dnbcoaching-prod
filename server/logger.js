/**
 * @typedef {'debug' | 'info' | 'warn' | 'error'} LogLevel
 *
 * @typedef {Object} LogEntry
 * @property {LogLevel} level
 * @property {string} message
 * @property {string} timestamp
 * @property {Record<string, unknown>} [context]
 * @property {{ message: string; stack?: string }} [error]
 */

function formatError(err) {
  if (!err) return undefined;
  if (err instanceof Error) {
    return { message: err.message, stack: err.stack };
  }
  return { message: String(err) };
}

function buildEntry(level, message, context, error) {
  const entry = {
    level,
    message,
    timestamp: new Date().toISOString(),
  };
  if (context && Object.keys(context).length > 0) {
    entry.context = context;
  }
  const formattedError = formatError(error);
  if (formattedError) {
    entry.error = formattedError;
  }
  return entry;
}

const isProduction = process.env.NODE_ENV === 'production';

function write(entry) {
  const method = entry.level === 'error' ? 'error' : entry.level === 'warn' ? 'warn' : 'log';

  if (isProduction) {
    // eslint-disable-next-line no-console
    console[method](JSON.stringify(entry));
    return;
  }

  // Human-readable format for development
  const prefix = `[${entry.timestamp}] ${entry.level.toUpperCase()}`;
  const parts = [prefix, entry.message];

  if (entry.context) {
    parts.push(JSON.stringify(entry.context, null, 2));
  }
  if (entry.error) {
    parts.push(entry.error.stack || entry.error.message);
  }

  // eslint-disable-next-line no-console
  console[method](...parts);
}

export const logger = {
  debug(message, context) {
    write(buildEntry('debug', message, context));
  },

  info(message, context) {
    write(buildEntry('info', message, context));
  },

  warn(message, context) {
    write(buildEntry('warn', message, context));
  },

  error(message, error, context) {
    write(buildEntry('error', message, context, error));
  },
};
