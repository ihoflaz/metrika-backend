import type { ErrorRequestHandler, Request, Response, NextFunction } from 'express';
import { isAppError } from '../../common/errors';
import { getRequestId } from './request-context';
import type { Logger } from '../../lib/logger';

export const createErrorHandler =
  (logger: Logger): ErrorRequestHandler =>
  (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (isAppError(err)) {
      logger.warn(
        { err, requestId: getRequestId(res), status: err.status, code: err.code },
        'Handled application error',
      );
      res.status(err.status).json({
        errors: [
          {
            code: err.code,
            title: err.title,
            detail: err.detail,
            meta: err.meta,
          },
        ],
        meta: {
          requestId: getRequestId(res),
        },
      });
      return;
    }

    logger.error({ err, requestId: getRequestId(res) }, 'Unhandled error encountered');
    res.status(500).json({
      errors: [
        {
          code: 'INTERNAL_SERVER_ERROR',
          title: 'Internal Server Error',
          detail: err instanceof Error ? err.message : 'Unexpected error occurred',
        },
      ],
      meta: { requestId: getRequestId(res) },
    });
  };
