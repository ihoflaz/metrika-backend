import type { Request, Response, NextFunction } from 'express';
import { getKPIBreachService } from '../../../modules/kpi/kpi-breach.service';
import { logger } from '../../../lib/logger';
import type { AuthenticatedRequestUser } from '../../types/auth-context';

/**
 * GET /api/v1/kpis/breaches
 * Get list of all currently breached KPIs
 */
export async function getBreachedKPIs(req: Request, res: Response, next: NextFunction) {
  try {
    const authUser = res.locals.authUser as AuthenticatedRequestUser;
    logger.info({ userId: authUser.id }, '[KPIBreachController] Fetching breached KPIs');

    const kpiBreachService = getKPIBreachService();
    const breaches = await kpiBreachService.getBreachedKPIs();

    logger.info(
      { userId: authUser.id, breachCount: breaches.length },
      '[KPIBreachController] Breached KPIs fetched'
    );

    res.json({
      data: breaches,
      meta: {
        total: breaches.length,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/v1/kpis/:id/corrective-action
 * Manually trigger corrective action for a specific KPI
 */
export async function triggerCorrectiveAction(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const authUser = res.locals.authUser as AuthenticatedRequestUser;
    const { id: kpiId } = req.params;

    logger.info(
      { userId: authUser.id, kpiId },
      '[KPIBreachController] Manual corrective action triggered'
    );

    const kpiBreachService = getKPIBreachService();
    const result = await kpiBreachService.triggerCorrectiveAction(kpiId);

    if (!result) {
      logger.info({ userId: authUser.id, kpiId }, '[KPIBreachController] No breach detected for KPI');

      return res.status(200).json({
        success: false,
        message: 'No breach detected for this KPI',
        data: null,
      });
    }

    logger.info(
      {
        userId: authUser.id,
        kpiId,
        taskId: result.taskId,
        created: result.created,
      },
      '[KPIBreachController] Corrective action processed'
    );

    res.json({
      success: true,
      message: result.created
        ? 'Corrective action task created successfully'
        : 'Corrective action task already exists',
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/v1/kpis/breaches/process
 * Process all breached KPIs and create corrective tasks
 * Admin-only endpoint
 */
export async function processAllBreaches(req: Request, res: Response, next: NextFunction) {
  try {
    const authUser = res.locals.authUser as AuthenticatedRequestUser;

    logger.info({ userId: authUser.id }, '[KPIBreachController] Processing all breaches');

    const kpiBreachService = getKPIBreachService();
    const summary = await kpiBreachService.processBreaches();

    logger.info(
      {
        userId: authUser.id,
        totalBreaches: summary.totalBreaches,
        tasksCreated: summary.tasksCreated,
        tasksDuplicate: summary.tasksDuplicate,
      },
      '[KPIBreachController] Breach processing complete'
    );

    res.json({
      success: true,
      message: `Processed ${summary.totalBreaches} breaches: ${summary.tasksCreated} tasks created, ${summary.tasksDuplicate} duplicates skipped`,
      data: summary,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/v1/kpis/:id/breach-status
 * Check if a specific KPI is currently breached
 */
export async function checkKPIBreachStatus(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const authUser = res.locals.authUser as AuthenticatedRequestUser;
    const { id: kpiId } = req.params;

    logger.debug({ userId: authUser.id, kpiId }, '[KPIBreachController] Checking KPI breach status');

    const kpiBreachService = getKPIBreachService();
    const breach = await kpiBreachService.checkKPIBreach(kpiId);

    if (!breach) {
      return res.json({
        breached: false,
        message: 'KPI is within acceptable thresholds',
        data: null,
      });
    }

    logger.info(
      { userId: authUser.id, kpiId, breachType: breach.breachType },
      '[KPIBreachController] Breach detected'
    );

    res.json({
      breached: true,
      message: `KPI has breached ${breach.breachType} threshold`,
      data: breach,
    });
  } catch (error) {
    next(error);
  }
}
