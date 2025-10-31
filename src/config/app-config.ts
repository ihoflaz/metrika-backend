import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_HOST: z.string().trim().min(1).default('0.0.0.0'),
  APP_PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  LOG_LEVEL: z.string().trim().default('info'),
  DATABASE_URL: z.string().url(),
  AUTH_ACCESS_TOKEN_SECRET: z.string().min(16, 'access token secret too short'),
  AUTH_REFRESH_TOKEN_SECRET: z.string().min(32, 'refresh token secret too short'),
  AUTH_ACCESS_TOKEN_TTL: z.coerce.number().int().positive().default(900),
  AUTH_REFRESH_TOKEN_TTL: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 14),
  PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).default(12),
});

export type AppConfig = z.infer<typeof envSchema>;

export const loadAppConfig = (
  overrides: Partial<Record<keyof AppConfig, unknown>> = {},
): AppConfig => {
  const parsed = envSchema.safeParse({ ...process.env, ...overrides });

  if (!parsed.success) {
    const issues = parsed.error.flatten();
    throw new Error(`Configuration validation failed: ${JSON.stringify(issues.fieldErrors)}`);
  }

  return parsed.data;
};
