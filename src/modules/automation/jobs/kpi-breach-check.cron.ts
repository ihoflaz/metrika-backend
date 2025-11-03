import { PrismaClient } from '@prisma/client';
import { getKPIBreachService } from '../../kpi/kpi-breach.service';
import { createLogger } from '../../../lib/logger';

const logger = createLogger({ name: 'KpiBreachCheckCron' });
const prisma = new PrismaClient();

/**
 * KPI Breach Check Cron Job (Updated for Day 14 - FR-44)
 * 
 * Runs every 6 hours.
 * 
 * Uses KPIBreachService to:
 * 1. Check all active KPIs for threshold breaches
 * 2. Create corrective action tasks automatically
 * 3. Update KPI status to BREACHED
 * 4. Prevent duplicate corrective tasks
 */
export async function kpiBreachCheckCron(): Promise<void> {
  try {
    logger.info('[KpiBreachCheckCron] Starting KPI breach check');

    const kpiBreachService = getKPIBreachService();
    
    // Process all breaches using the new service
    const summary = await kpiBreachService.processBreaches();

    logger.info({
      totalBreaches: summary.totalBreaches,
      tasksCreated: summary.tasksCreated,
      tasksDuplicate: summary.tasksDuplicate,
    }, '[KpiBreachCheckCron] ✅ KPI breach check completed');

    // Log details of created tasks
    if (summary.tasksCreated > 0) {
      const createdTasks = summary.results.filter(r => r.created);
      logger.info({
        tasks: createdTasks.map(t => ({
          kpiId: t.kpiId,
          taskId: t.taskId,
          breachType: t.breachType,
        })),
      }, '[KpiBreachCheckCron] Corrective tasks created');
    }
  } catch (error) {
    logger.error({ error }, '[KpiBreachCheckCron] ❌ KPI breach check failed');
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}
