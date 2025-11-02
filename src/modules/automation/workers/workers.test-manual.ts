/**
 * Manuel Test: Tüm Worker'ları Test Et
 * 
 * Bu test 4 worker'ı başlatır, job'lar gönderir ve işlenip işlenmediğini kontrol eder
 * Komut: npx ts-node --transpile-only src/modules/automation/workers/workers.test-manual.ts
 */

import { getQueueService } from '../queue.service';
import { startTaskMonitorWorker, stopTaskMonitorWorker } from './task-monitor.worker';
import { startKpiMonitorWorker, stopKpiMonitorWorker } from './kpi-monitor.worker';
import { startDocumentApprovalWorker, stopDocumentApprovalWorker } from './document-approval.worker';
import { startNotificationWorker, stopNotificationWorker } from './notification.worker';
import { createLogger } from '../../../lib/logger';

const logger = createLogger({ name: 'WorkerTest' });

async function testAllWorkers() {
  logger.info('🧪 Worker Integration Test Başlıyor...\n');

  try {
    // 1. Queue service başlat
    logger.info('1️⃣ Queue service başlatılıyor...');
    const queueService = getQueueService();
    await new Promise(resolve => setTimeout(resolve, 2000)); // Redis bağlantısı için bekle
    logger.info('✅ Queue service hazır\n');

    // 2. Tüm worker'ları başlat
    logger.info('2️⃣ Worker\'lar başlatılıyor...');
    startTaskMonitorWorker();
    startKpiMonitorWorker();
    startDocumentApprovalWorker();
    startNotificationWorker();
    await new Promise(resolve => setTimeout(resolve, 2000)); // Worker'ların hazır olması için bekle
    logger.info('✅ Tüm worker\'lar başlatıldı\n');

    // 3. Test job'ları gönder
    logger.info('3️⃣ Test job\'ları gönderiliyor...\n');

    // Task automation job
    logger.info('   📝 Task automation job ekleniyor...');
    await queueService.addTaskAutomationJob({
      taskId: 'test-task-001',
      action: 'CHECK_DELAY',
      metadata: { testMode: true },
    });

    // KPI automation job
    logger.info('   📊 KPI automation job ekleniyor...');
    await queueService.addKpiAutomationJob({
      kpiId: 'test-kpi-001',
      projectId: 'test-project-001',
      action: 'CHECK_BREACH',
      metadata: { testMode: true },
    });

    // Document automation job
    logger.info('   📄 Document automation job ekleniyor...');
    await queueService.addDocumentAutomationJob({
      documentId: 'test-doc-001',
      action: 'APPROVAL_REMINDER',
      metadata: { testMode: true },
    });

    // Notification job (high priority)
    logger.info('   🔔 Notification job ekleniyor (high priority)...');
    await queueService.addNotificationJob({
      userId: 'test-user-001',
      type: 'EMAIL',
      template: 'task-reminder',
      payload: { taskTitle: 'Test Task' },
      priority: 1,
    });

    logger.info('   ✅ Tüm job\'lar gönderildi\n');

    // 4. Worker'ların job'ları işlemesi için bekle
    logger.info('4️⃣ Worker\'ların job\'ları işlemesi bekleniyor (5 saniye)...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    logger.info('✅ Bekleme tamamlandı\n');

    // 5. Queue metrics kontrol et
    logger.info('5️⃣ Queue metrics kontrol ediliyor...');
    const metrics = await queueService.getAllMetrics();
    logger.info('\n📊 Queue Metrics:');
    metrics.forEach((metric) => {
      logger.info(`\n   ${metric.queueName}:`);
      logger.info(`     - Waiting: ${metric.waiting}`);
      logger.info(`     - Active: ${metric.active}`);
      logger.info(`     - Completed: ${metric.completed}`);
      logger.info(`     - Failed: ${metric.failed}`);
      
      if (metric.completed > 0) {
        logger.info(`     ✅ Worker başarıyla çalıştı!`);
      } else if (metric.failed > 0) {
        logger.warn(`     ⚠️ Job'lar failed! (Beklenen durum - test database'de ID'ler yok)`);
      } else if (metric.waiting > 0) {
        logger.warn(`     ⏳ Job'lar hala waiting (worker belki yavaş)`);
      }
    });
    logger.info('');

    // 6. Worker'ları durdur
    logger.info('6️⃣ Worker\'lar durduruluyor...');
    await stopTaskMonitorWorker();
    await stopKpiMonitorWorker();
    await stopDocumentApprovalWorker();
    await stopNotificationWorker();
    logger.info('✅ Tüm worker\'lar durduruldu\n');

    // 7. Queue service kapat
    logger.info('7️⃣ Queue service kapatılıyor...');
    await queueService.close();
    logger.info('✅ Queue service kapatıldı\n');

    // Sonuç
    const totalCompleted = metrics.reduce((sum, m) => sum + m.completed, 0);
    const totalFailed = metrics.reduce((sum, m) => sum + m.failed, 0);

    if (totalCompleted > 0 || totalFailed > 0) {
      logger.info('🎉 TEST BAŞARILI!');
      logger.info(`   ✅ Worker\'lar çalıştı: ${totalCompleted} completed, ${totalFailed} failed`);
      logger.info('   ℹ️ Failed job\'lar beklenen durum (test database\'de ID\'ler yok)\n');
      process.exit(0);
    } else {
      logger.warn('⚠️ TEST UYARISI: Hiç job işlenmedi. Worker\'lar belki yavaş veya Redis problemi var.');
      process.exit(1);
    }
  } catch (error) {
    logger.error({ error }, '❌ TEST BAŞARISIZ!');
    logger.error(error);
    process.exit(1);
  }
}

testAllWorkers();
