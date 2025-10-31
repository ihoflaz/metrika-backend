import pino from 'pino';

export type Logger = pino.Logger;

export interface LoggerOptions {
  name?: string;
  level?: string;
}

export const createLogger = (options: LoggerOptions = {}): Logger => {
  const { name = 'metrika-backend', level = process.env.LOG_LEVEL ?? 'info' } = options;

  return pino({
    name,
    level,
    transport:
      process.env.NODE_ENV === 'development'
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:standard',
            },
          }
        : undefined,
  });
};
