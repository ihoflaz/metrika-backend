import { config as loadEnv } from 'dotenv-flow';

export const initializeEnv = () => {
  const result = loadEnv({
    node_env: process.env.NODE_ENV,
    default_node_env: 'development',
    silent: true,
  });

  if (result.error && !result.error.message.includes('no ".env')) {
    throw result.error;
  }
};
