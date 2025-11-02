import type { ErrorRequestHandler, Request, Response, NextFunction } from 'express';
import { isAppError } from '../../common/errors';
import { getRequestId } from './request-context';
import type { Logger } from '../../lib/logger';
import { ZodError } from 'zod';

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

    // Handle Zod validation errors
    if (err instanceof ZodError) {
      logger.warn(
        { err, requestId: getRequestId(res) },
        'Validation error',
      );
      res.status(400).json({
        errors: err.issues.map((issue) => ({
          code: 'VALIDATION_ERROR',
          title: 'Validation Error',
          detail: issue.message,
          meta: {
            path: issue.path.join('.'),
            type: issue.code,
          },
        })),
        meta: { requestId: getRequestId(res) },
      });
      return;
    }

    // Handle errors with status codes (e.g., body-parser errors)
    if (err && typeof err === 'object' && ('status' in err || 'statusCode' in err)) {
      const status = ('status' in err && typeof err.status === 'number')
        ? err.status
        : ('statusCode' in err && typeof err.statusCode === 'number')
        ? err.statusCode
        : 500;
      
      const message = err instanceof Error ? err.message : 'Request error';
      
      logger.warn(
        { err, requestId: getRequestId(res), status },
        'HTTP error with status code',
      );
      
      res.status(status).json({
        errors: [
          {
            code: status === 400 ? 'BAD_REQUEST' : 'HTTP_ERROR',
            title: status === 400 ? 'Bad Request' : 'HTTP Error',
            detail: message,
          },
        ],
        meta: { requestId: getRequestId(res) },
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
