import { ConnectionOptions } from 'bullmq';

/**
 * BullMQ Queue İsimleri
 * Her işlem türü için ayrı queue kullanıyoruz
 */
export enum QueueName {
  TASK_AUTOMATION = 'task-automation',
  KPI_AUTOMATION = 'kpi-automation',
  DOCUMENT_AUTOMATION = 'document-automation',
  NOTIFICATION = 'notification',
}

/**
 * Redis bağlantı ayarları
 * Development: localhost:6379
 * Production: .env'den alınacak
 */
export const redisConnection: ConnectionOptions = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  maxRetriesPerRequest: null, // BullMQ requires this to be null
  retryStrategy: (times: number) => {
    // Exponential backoff: 1s, 2s, 4s, ...
    return Math.min(times * 1000, 10000);
  },
};

/**
 * Queue için default job options
 */
export const defaultJobOptions = {
  attempts: 3, // 3 kez deneme
  backoff: {
    type: 'exponential' as const,
    delay: 2000, // İlk retry 2s sonra
  },
  removeOnComplete: {
    age: 7 * 24 * 3600, // 7 gün sonra sil
    count: 1000, // Max 1000 completed job tut
  },
  removeOnFail: {
    age: 30 * 24 * 3600, // 30 gün sonra sil
  },
};

/**
 * Cron Job Schedule'ları
 */
export const cronSchedules = {
  // Her 30 dakikada bir - Geciken taskları kontrol et
  TASK_DELAY_CHECK: '*/30 * * * *',
  
  // Her 6 saatte bir - KPI breach kontrolü
  KPI_BREACH_CHECK: '0 */6 * * *',
  
  // Her 15 dakikada bir - Bekleyen bildirimleri gönder
  NOTIFICATION_BATCH: '*/15 * * * *',
  
  // Her Pazartesi 09:00 - Haftalık özet raporu
  WEEKLY_SUMMARY: '0 9 * * 1',
};
