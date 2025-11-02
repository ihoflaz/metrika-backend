import { Router, type Request, type Response, type NextFunction } from 'express';
import { getQueueService } from '../../../modules/automation/queue.service';
import { getCronService } from '../../../modules/automation/cron.service';

export const createQueueRouter = () => {
  const router = Router();

  /**
   * GET /api/v1/queues/metrics
   * 
   * Tüm queue'ların durumunu ve metriklerini döndür
   */
  router.get('/metrics', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const queueService = getQueueService();
      const metrics = await queueService.getAllMetrics();

      res.json({
        data: metrics,
        meta: {
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/v1/queues/cron-status
   * 
   * Cron job'ların durumunu döndür
   */
  router.get('/cron-status', (_req: Request, res: Response, next: NextFunction) => {
    try {
      const cronService = getCronService();
      const status = cronService.getStatus();

      res.json({
        data: status,
        meta: {
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
};
