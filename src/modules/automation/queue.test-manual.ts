/**
 * Manuel Test: QueueService Redis Bağlantısı
 * 
 * Bu dosyayı çalıştırarak QueueService'in Redis'e bağlanıp bağlanmadığını test ediyoruz
 * Komut: npx ts-node --transpile-only src/modules/automation/queue.test-manual.ts
 */

import { getQueueService } from './queue.service';
import { createLogger } from '../../lib/logger';

const logger = createLogger({ name: 'QueueTest' });

async function testQueueService() {
  logger.info('🧪 QueueService Manuel Test Başlıyor...\n');

  try {
    // 1. QueueService'i başlat
    logger.info('1️⃣ QueueService başlatılıyor...');
    const queueService = getQueueService();
    await new Promise(resolve => setTimeout(resolve, 2000)); // Redis bağlantısı için bekle
    logger.info('✅ QueueService başlatıldı\n');

    // 2. Task automation job ekle
    logger.info('2️⃣ Task automation job ekleniyor...');
    const taskJob = await queueService.addTaskAutomationJob({
      taskId: 'test-task-123',
      action: 'CHECK_DELAY',
      metadata: { testMode: true },
    });
    logger.info(`✅ Task job eklendi: ${taskJob.id}\n`);

    // 3. Notification job ekle (yüksek öncelik)
    logger.info('3️⃣ Notification job ekleniyor...');
    const notifJob = await queueService.addNotificationJob({
      userId: 'test-user-456',
      type: 'EMAIL',
      template: 'task-reminder',
      payload: { taskName: 'Test Task' },
      priority: 1, // Yüksek öncelik
    });
    logger.info(`✅ Notification job eklendi: ${notifJob.id}\n`);

    // 4. Queue metrics'leri kontrol et
    logger.info('4️⃣ Queue metrics kontrol ediliyor...');
    const metrics = await queueService.getAllMetrics();
    logger.info('📊 Queue Metrics:');
    metrics.forEach((metric) => {
      logger.info(`   ${metric.queueName}:`);
      logger.info(`     - Waiting: ${metric.waiting}`);
      logger.info(`     - Active: ${metric.active}`);
      logger.info(`     - Completed: ${metric.completed}`);
      logger.info(`     - Failed: ${metric.failed}`);
      logger.info(`     - Total: ${metric.total}`);
    });
    logger.info('');

    // 5. Graceful shutdown
    logger.info('5️⃣ QueueService kapatılıyor...');
    await queueService.close();
    logger.info('✅ QueueService kapatıldı\n');

    logger.info('🎉 TEST BAŞARILI! QueueService Redis\'e bağlanıyor ve job ekleyebiliyor.\n');
    process.exit(0);
  } catch (error) {
    logger.error({ error }, '❌ TEST BAŞARISIZ!');
    logger.error(error);
    process.exit(1);
  }
}

testQueueService();
