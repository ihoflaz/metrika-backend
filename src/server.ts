import type { Server } from 'node:http';
import { buildContainer } from './di/container';

export const startServer = async (): Promise<Server> => {
  const container = buildContainer();
  const config = container.resolve('config');
  const logger = container.resolve('logger');
  const app = container.resolve('app');

  return new Promise<Server>((resolve, reject) => {
    const server = app.listen(config.APP_PORT, config.APP_HOST, () => {
      logger.info({ port: config.APP_PORT, host: config.APP_HOST }, 'HTTP server started');
      resolve(server);
    });

    server.on('error', (err: Error) => {
      logger.error({ err }, 'Failed to start HTTP server');
      reject(err);
    });
  });
};

if (require.main === module) {
  startServer().catch((error) => {
    // eslint-disable-next-line no-console
    console.error('Fatal error while starting the server', error);
    process.exitCode = 1;
  });
}
