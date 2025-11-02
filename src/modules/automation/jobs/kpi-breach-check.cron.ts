import { PrismaClient, KPIStatus } from '@prisma/client';
import { getQueueService } from '../queue.service';
import { createLogger } from '../../../lib/logger';

const logger = createLogger({ name: 'KpiBreachCheckCron' });
const prisma = new PrismaClient();

/**
 * KPI Breach Check Cron Job
 * 
 * Her 6 saatte çalışır.
 * 
 * Kontroller:
 * 1. Critical threshold breach (actualValue > thresholdCritical)
 * 2. Warning threshold breach (actualValue > thresholdWarning)
 */
export async function kpiBreachCheckCron(): Promise<void> {
  try {
    const queueService = getQueueService();

    // Sadece ACTIVE ve MONITORING status'ündeki KPI'ları kontrol et
    const activeKpis = await prisma.kPIDefinition.findMany({
      where: {
        status: {
          in: [KPIStatus.ACTIVE, KPIStatus.MONITORING],
        },
      },
      include: {
        series: {
          orderBy: { periodEnd: 'desc' },
          take: 1, // En son değer
        },
      },
    });

    logger.info(`Checking ${activeKpis.length} active KPIs`);

    let criticalBreaches = 0;
    let warningBreaches = 0;

    for (const kpi of activeKpis) {
      if (kpi.series.length === 0) {
        continue; // Veri yok
      }

      const latestValue = parseFloat(kpi.series[0].actualValue.toString());
      const targetValue = parseFloat(kpi.targetValue.toString());
      const thresholdCritical = kpi.thresholdCritical
        ? parseFloat(kpi.thresholdCritical.toString())
        : null;
      const thresholdWarning = kpi.thresholdWarning
        ? parseFloat(kpi.thresholdWarning.toString())
        : null;

      // Critical breach check (value below critical threshold)
      if (thresholdCritical && latestValue < thresholdCritical) {
        const deviation = ((latestValue - thresholdCritical) / thresholdCritical) * 100;

        // 1) Email notification gönder
        await queueService.addKpiAutomationJob({
          kpiId: kpi.id,
          projectId: kpi.linkedProjectIds[0] || 'unknown',
          action: 'CHECK_BREACH',
          metadata: {
            threshold: 'critical',
            actualValue: latestValue,
            thresholdValue: thresholdCritical,
            deviation,
          },
        });

        // 2) Corrective action task oluştur (FR-44)
        if (kpi.linkedProjectIds && kpi.linkedProjectIds.length > 0) {
          await queueService.addKpiAutomationJob({
            kpiId: kpi.id,
            projectId: kpi.linkedProjectIds[0],
            action: 'TRIGGER_ACTION',
            metadata: {
              threshold: 'critical',
              actualValue: latestValue,
              thresholdValue: thresholdCritical,
              deviation,
              reason: 'Critical threshold breach - auto-creating corrective action task',
            },
          });
        }

        criticalBreaches++;
        
        // Status'ü BREACHED yap
        await prisma.kPIDefinition.update({
          where: { id: kpi.id },
          data: { status: KPIStatus.BREACHED },
        });
      }
      // Warning breach check (value below warning threshold but above critical)
      else if (thresholdWarning && latestValue < thresholdWarning) {
        const deviation = ((latestValue - thresholdWarning) / thresholdWarning) * 100;

        await queueService.addKpiAutomationJob({
          kpiId: kpi.id,
          projectId: kpi.linkedProjectIds[0] || 'unknown',
          action: 'CHECK_BREACH',
          metadata: {
            threshold: 'warning',
            actualValue: latestValue,
            thresholdValue: thresholdWarning,
            deviation,
          },
        });

        warningBreaches++;
        
        // Status'ü MONITORING yap
        await prisma.kPIDefinition.update({
          where: { id: kpi.id },
          data: { status: KPIStatus.MONITORING },
        });
      }
      // Normal - Status'ü ACTIVE yap
      else if (kpi.status !== KPIStatus.ACTIVE) {
        await prisma.kPIDefinition.update({
          where: { id: kpi.id },
          data: { status: KPIStatus.ACTIVE },
        });
      }
    }

    logger.info({
      totalKpis: activeKpis.length,
      criticalBreaches,
      warningBreaches,
    }, '✅ KPI breach check completed');
  } catch (error) {
    logger.error({ error }, '❌ KPI breach check failed');
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}
