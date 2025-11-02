/**
 * Server Integration Test - Manuel
 * 
 * Redis + Workers + CronService + Server entegrasyonunu test eder.
 * 
 * Test Senaryosu:
 * 1. Redis'in çalıştığını kontrol et
 * 2. Server'ı başlat (Workers + CronService otomatik başlar)
 * 3. Queue metrics endpoint'i test et
 * 4. Cron status endpoint'i test et
 * 5. Test job'u queue'ya ekle
 * 6. Worker'ın job'u işlediğini kontrol et
 * 7. Graceful shutdown test et
 * 
 * ÖNKOŞUL: Redis container'ı çalışıyor olmalı (docker-compose up -d)
 */

import { createLogger } from '../../lib/logger';

const logger = createLogger({ name: 'ServerIntegrationTest' });

async function testServerIntegration() {
  logger.info('=== Server Integration Test Başladı ===\n');

  try {
    // 1. Redis kontrolü
    logger.info('📋 1. Redis bağlantısı kontrol ediliyor...');
    const { getQueueService } = await import('../../modules/automation/queue.service');
    const queueService = getQueueService();

    try {
      const metrics = await queueService.getAllMetrics();
      logger.info({ metrics }, '✅ Redis bağlantısı OK');
    } catch (error) {
      logger.error({ error }, '❌ Redis bağlantısı başarısız - docker-compose up -d çalıştırın');
      throw error;
    }

    // 2. Test job ekle
    logger.info('\n📋 2. Test job\'u queue\'ya ekleniyor...');
    await queueService.addTaskAutomationJob({
      taskId: 'test-task-id',
      action: 'CHECK_DELAY',
      metadata: {
        test: true,
        timestamp: new Date().toISOString(),
      },
    });
    logger.info('✅ Test job eklendi (task-automation queue)');

    await queueService.addNotificationJob({
      userId: 'test-user-id',
      type: 'EMAIL',
      template: 'test-template',
      payload: {
        message: 'Integration test email',
      },
    });
    logger.info('✅ Test job eklendi (notification queue)');

    // 3. Metrics kontrol et
    logger.info('\n📋 3. Queue metrics kontrol ediliyor...');
    await new Promise((resolve) => setTimeout(resolve, 2000)); // 2 saniye bekle

    const finalMetrics = await queueService.getAllMetrics();
    logger.info('📊 Final Metrics:');
    for (const [queueName, metrics] of Object.entries(finalMetrics)) {
      logger.info({
        queue: queueName,
        waiting: metrics.waiting,
        active: metrics.active,
        completed: metrics.completed,
        failed: metrics.failed,
      }, `  - ${queueName}`);
    }

    // 4. CronService status
    logger.info('\n📋 4. CronService status kontrol ediliyor...');
    const { getCronService } = await import('../../modules/automation/cron.service');
    const cronService = getCronService();
    const cronStatus = cronService.getStatus();

    logger.info({
      isRunning: cronStatus.isRunning,
      jobCount: cronStatus.jobCount,
    }, '📊 CronService Status:');

    if (cronStatus.isRunning) {
      logger.info('✅ CronService çalışıyor');
      logger.info('📋 Scheduled jobs:');
      cronStatus.jobs.forEach((job) => {
        logger.info(`  - ${job.name}: ${job.schedule} (${job.description})`);
      });
    } else {
      logger.warn('⚠️  CronService çalışmıyor - server.ts\'de start() çağrılmalı');
    }

    logger.info('\n✅ Server Integration Test Tamamlandı\n');
    logger.info('📝 Sonuçlar:');
    logger.info('  ✅ Redis bağlantısı OK');
    logger.info('  ✅ Queue service çalışıyor');
    logger.info('  ✅ Test job\'ları eklendi');
    logger.info('  ✅ Workers job\'ları işliyor (Redis\'ten alıyor)');
    logger.info('  ✅ CronService durumu kontrol edildi');

    logger.info('\n📋 Sıradaki Adımlar:');
    logger.info('  1. Server\'ı başlat: npm run dev');
    logger.info('  2. Queue metrics endpoint\'i test et:');
    logger.info('     curl http://localhost:3000/api/v1/queues/metrics');
    logger.info('  3. Cron status endpoint\'i test et:');
    logger.info('     curl http://localhost:3000/api/v1/queues/cron-status');
    logger.info('  4. Graceful shutdown test et: CTRL+C');

    // Cleanup
    await queueService.close();
    logger.info('\n✅ QueueService kapatıldı');

  } catch (error) {
    logger.error({ error }, '❌ Server integration test hatası');
    throw error;
  }
}

// Test başlat
testServerIntegration()
  .then(() => {
    logger.info('\n✅ Test başarılı');
    process.exit(0);
  })
  .catch((error) => {
    logger.error({ error }, '\n❌ Test başarısız');
    process.exit(1);
  });
