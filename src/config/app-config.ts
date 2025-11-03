import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_HOST: z.string().trim().min(1).default('0.0.0.0'),
  APP_PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  LOG_LEVEL: z.string().trim().default('info'),
  DATABASE_URL: z.string().url(),
  AUTH_ACCESS_TOKEN_SECRET: z.string().min(16, 'access token secret too short'),
  AUTH_REFRESH_TOKEN_SECRET: z.string().min(32, 'refresh token secret too short'),
  AUTH_ACCESS_TOKEN_SECRET_FALLBACKS: z.string().optional(),
  AUTH_REFRESH_TOKEN_SECRET_FALLBACKS: z.string().optional(),
  AUTH_ACCESS_TOKEN_TTL: z.coerce.number().int().positive().default(900),
  AUTH_REFRESH_TOKEN_TTL: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 14),
  AUTH_TOKEN_RATE_LIMIT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),
  AUTH_TOKEN_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).default(12),
  SMTP_HOST: z.string().trim().min(1),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_TLS_REJECT_UNAUTHORIZED: z.coerce.boolean().default(true),
  SMTP_USERNAME: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().trim().email().default('no-reply@metrika.local'),
  STORAGE_ENDPOINT: z.string().trim().default('http://localhost:9000'),
  STORAGE_REGION: z.string().trim().default('us-east-1'),
  STORAGE_ACCESS_KEY: z.string().trim().min(1),
  STORAGE_SECRET_KEY: z.string().trim().min(1),
  STORAGE_BUCKET: z.string().trim().min(1),
  CLAMAV_HOST: z.string().trim().default('localhost'),
  CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
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
