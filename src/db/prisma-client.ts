import { PrismaClient } from '@prisma/client';
import type { AppConfig } from '../config/app-config';

export const createPrismaClient = (config: AppConfig): PrismaClient => {
  return new PrismaClient({
    datasources: {
      db: {
        url: config.DATABASE_URL,
      },
    },
  });
};

export type DatabaseClient = PrismaClient;
