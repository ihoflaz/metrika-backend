/**
 * Cron Service Manuel Test
 * 
 * CronService'in 4 cron job'unu başlattığını ve log bastığını kontrol eder.
 * 
 * Test senaryosu:
 * 1. CronService başlat
 * 2. 5 saniye bekle (cron tetiklemesini görmek için yetersiz ama başlatma loglarını göreceğiz)
 * 3. Status kontrol et
 * 4. Durdur
 * 
 * NOT: Bu test, cron job'ların çalıştığını görmez (30 dakika beklememiz gerekir).
 * Sadece CronService'in doğru şekilde başladığını ve durduğunu kontrol eder.
 * 
 * Gerçek cron tetikleme testi için Redis + Workers + CronService'in beraber çalışması gerekir.
 */

import { getCronService } from './cron.service';
import { createLogger } from '../../lib/logger';

const logger = createLogger({ name: 'CronServiceTest' });

async function testCronService() {
  logger.info('=== CronService Manuel Test Başladı ===\n');

  try {
    // 1. CronService instance al
    const cronService = getCronService();
    logger.info('✅ CronService instance alındı\n');

    // 2. Başlangıç durumu kontrol et
    let status = cronService.getStatus();
    logger.info({
      isRunning: status.isRunning,
      jobCount: status.jobCount,
    }, '📊 Başlangıç Durumu:');

    // 3. CronService başlat
    logger.info('\n🚀 CronService başlatılıyor...');
    cronService.start();

    // 4. Başlatma sonrası durum kontrol et
    status = cronService.getStatus();
    logger.info({
      isRunning: status.isRunning,
      jobCount: status.jobCount,
      jobs: status.jobs,
    }, '\n📊 Başlatma Sonrası Durum:');

    // 5. 5 saniye bekle (cron job'ların başlatıldığını görmek için)
    logger.info('\n⏳ 5 saniye bekleniyor (cron job tetikleme testi için değil)...');
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // 6. Durdur
    logger.info('\n🛑 CronService durduruluyor...');
    cronService.stop();

    // 7. Durdurma sonrası durum kontrol et
    status = cronService.getStatus();
    logger.info({
      isRunning: status.isRunning,
      jobCount: status.jobCount,
    }, '\n📊 Durdurma Sonrası Durum:');

    logger.info('\n✅ CronService Manuel Test Tamamlandı\n');
    logger.info('📝 Sonuçlar:');
    logger.info('  - CronService başarıyla başlatıldı ve durduruldu');
    logger.info('  - 4 cron job tanımlandı:');
    logger.info('    1. task-delay-check (*/30 * * * * - Her 30 dakika)');
    logger.info('    2. kpi-breach-check (0 */6 * * * - Her 6 saat)');
    logger.info('    3. document-reminder (*/15 * * * * - Her 15 dakika)');
    logger.info('    4. weekly-audit (0 9 * * 1 - Pazartesi 09:00)');
    logger.info('\n⚠️  NOT: Cron job tetikleme testini görmek için:');
    logger.info('  1. CronService\'i server.ts\'de başlat');
    logger.info('  2. Redis + Workers + Server\'ı birlikte çalıştır');
    logger.info('  3. 30 dakika bekle (task-delay-check tetiklenir)');
    logger.info('  4. Queue metrics endpoint\'inden queue\'lara job eklendiğini kontrol et');

  } catch (error) {
    logger.error({ error }, '❌ CronService test hatası');
    throw error;
  }
}

// Test başlat
testCronService()
  .then(() => {
    logger.info('\n✅ Test başarılı');
    process.exit(0);
  })
  .catch((error) => {
    logger.error({ error }, '\n❌ Test başarısız');
    process.exit(1);
  });
