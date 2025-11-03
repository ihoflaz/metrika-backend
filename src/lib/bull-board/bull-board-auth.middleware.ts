import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../logger';

const logger = createLogger({ name: 'BullBoardAuth' });

/**
 * Bull Board Authentication Middleware
 * 
 * Bull Board UI'a erişimi kısıtlar:
 * - Kullanıcı authenticate olmalı
 * - Kullanıcı ADMIN veya PMO_ADMIN rolüne sahip olmalı
 * 
 * Production'da mutlaka kullanılmalı!
 */
export function bullBoardAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void | Response {
  // Development mode'da bypass (opsiyonel)
  if (process.env.NODE_ENV === 'development' && process.env.BULL_BOARD_NO_AUTH === 'true') {
    logger.warn('⚠️ Bull Board authentication bypassed (development mode)');
    return next();
  }

  // Check authentication
  const user = (req as any).user;
  if (!user) {
    logger.warn({ ip: req.ip, url: req.url }, '🚫 Unauthenticated access attempt to Bull Board');
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required to access Bull Board',
    });
  }

  // Check admin role
  const hasAdminRole = user.roles?.some((role: any) => 
    role.role?.name === 'ADMIN' || role.role?.name === 'PMO_ADMIN'
  );

  if (!hasAdminRole) {
    logger.warn(
      { userId: user.id, email: user.email, url: req.url },
      '🚫 Unauthorized access attempt to Bull Board (non-admin user)'
    );
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Admin privileges required to access Bull Board',
    });
  }

  // Access granted
  logger.info(
    { userId: user.id, email: user.email, url: req.url },
    '✅ Admin user accessed Bull Board'
  );
  next();
}

/**
 * Simple Basic Auth middleware (alternative for simple setups)
 * 
 * Usage:
 *   BULL_BOARD_USERNAME=admin
 *   BULL_BOARD_PASSWORD=secret123
 */
export function bullBoardBasicAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void | Response {
  const username = process.env.BULL_BOARD_USERNAME || 'admin';
  const password = process.env.BULL_BOARD_PASSWORD;

  if (!password) {
    logger.error('BULL_BOARD_PASSWORD not set in environment');
    return res.status(500).json({
      error: 'Configuration Error',
      message: 'Bull Board authentication not configured',
    });
  }

  // Parse authorization header
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Bull Board"');
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Basic authentication required',
    });
  }

  // Decode credentials
  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
  const [providedUsername, providedPassword] = credentials.split(':');

  // Verify credentials
  if (providedUsername === username && providedPassword === password) {
    logger.info({ username: providedUsername, url: req.url }, '✅ Basic auth successful');
    return next();
  }

  // Invalid credentials
  logger.warn({ username: providedUsername, url: req.url }, '🚫 Basic auth failed');
  res.setHeader('WWW-Authenticate', 'Basic realm="Bull Board"');
  return res.status(401).json({
    error: 'Unauthorized',
    message: 'Invalid credentials',
  });
}
