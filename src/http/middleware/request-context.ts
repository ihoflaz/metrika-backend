import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const REQUEST_ID_HEADER = 'x-request-id';

export const requestContextMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const incomingRequestId = req.header(REQUEST_ID_HEADER);
  const requestId =
    incomingRequestId && incomingRequestId.length > 0 ? incomingRequestId : randomUUID();

  res.setHeader('X-Request-ID', requestId);
  res.locals.requestId = requestId;

  next();
};

export const getRequestId = (res: Response): string | null =>
  typeof res.locals.requestId === 'string' ? res.locals.requestId : null;
