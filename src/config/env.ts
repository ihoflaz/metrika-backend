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
