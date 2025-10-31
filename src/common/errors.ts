export type ErrorMeta = Record<string, unknown>;

export interface AppErrorOptions {
  status: number;
  code: string;
  title: string;
  detail?: string;
  meta?: ErrorMeta;
  cause?: unknown;
}

export class AppError extends Error {
  public readonly status: number;

  public readonly code: string;

  public readonly title: string;

  public readonly detail?: string;

  public readonly meta?: ErrorMeta;

  constructor(options: AppErrorOptions) {
    super(options.detail ?? options.title, { cause: options.cause });
    this.name = 'AppError';
    this.status = options.status;
    this.code = options.code;
    this.title = options.title;
    this.detail = options.detail;
    this.meta = options.meta;
  }
}

export const isAppError = (error: unknown): error is AppError =>
  error instanceof AppError && typeof error.status === 'number';

export const createAppError = (options: AppErrorOptions): AppError => new AppError(options);

export const unauthorizedError = (detail?: string, meta?: ErrorMeta) =>
  createAppError({
    status: 401,
    code: 'AUTH_UNAUTHORIZED',
    title: 'Unauthorized',
    detail,
    meta,
  });

export const forbiddenError = (code: string, title: string, detail?: string, meta?: ErrorMeta) =>
  createAppError({
    status: 403,
    code,
    title,
    detail,
    meta,
  });

export const badRequestError = (code: string, title: string, detail?: string, meta?: ErrorMeta) =>
  createAppError({
    status: 400,
    code,
    title,
    detail,
    meta,
  });

export const validationError = (errors: ErrorMeta) =>
  createAppError({
    status: 422,
    code: 'VALIDATION_FAILED',
    title: 'Validation failed',
    meta: errors,
  });

export const notFoundError = (code: string, title: string, detail?: string, meta?: ErrorMeta) =>
  createAppError({
    status: 404,
    code,
    title,
    detail,
    meta,
  });
