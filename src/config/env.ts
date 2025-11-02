import { config as loadEnv } from 'dotenv-flow';

let envInitialized = false;

export const initializeEnv = () => {
  if (envInitialized) {
    return;
  }

  const result = loadEnv({
    node_env: process.env.NODE_ENV,
    default_node_env: 'development',
    silent: true,
  });

  if (result.error && !result.error.message.includes('no ".env')) {
    throw result.error;
  }

  envInitialized = true;
};

export const resetEnvInitialization = () => {
  envInitialized = false;
};

// Email configuration
export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3000', 10),
  
  // App
  APP_URL: process.env.APP_URL || 'http://localhost:3000',
  
  // Redis
  REDIS_HOST: process.env.REDIS_HOST || 'localhost',
  REDIS_PORT: parseInt(process.env.REDIS_PORT || '6379', 10),
  REDIS_PASSWORD: process.env.REDIS_PASSWORD,
  REDIS_DB: parseInt(process.env.REDIS_DB || '0', 10),
  
  // SMTP
  SMTP_HOST: process.env.SMTP_HOST || 'localhost',
  SMTP_PORT: parseInt(process.env.SMTP_PORT || '587', 10),
  SMTP_SECURE: process.env.SMTP_SECURE === 'true',
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASSWORD: process.env.SMTP_PASSWORD || '',
  SMTP_FROM_NAME: process.env.SMTP_FROM_NAME || 'Metrika PMO',
  SMTP_FROM_EMAIL: process.env.SMTP_FROM_EMAIL || 'noreply@metrika.com',
};
