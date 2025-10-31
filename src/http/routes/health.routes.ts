import { Router, type Request, type Response } from 'express';
import { getRequestId } from '../middleware/request-context';

export const createHealthRouter = (): Router => {
  const router = Router();

  router.get('/healthz', (req: Request, res: Response) => {
    res.status(200).json({
      data: {
        type: 'health',
        attributes: {
          status: 'ok',
          timestamp: new Date().toISOString(),
        },
      },
      meta: {
        requestId: getRequestId(res) ?? req.header('x-request-id') ?? null,
      },
    });
  });

  router.get('/readyz', (req: Request, res: Response) => {
    res.status(200).json({
      data: {
        type: 'readiness',
        attributes: {
          status: 'ready',
          timestamp: new Date().toISOString(),
        },
      },
      meta: {
        requestId: getRequestId(res) ?? req.header('x-request-id') ?? null,
      },
    });
  });

  return router;
};
