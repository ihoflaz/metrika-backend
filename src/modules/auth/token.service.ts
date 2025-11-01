import { createHash, randomBytes } from 'node:crypto';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import type { AppConfig } from '../../config/app-config';
import { unauthorizedError } from '../../common/errors';

export interface AccessTokenPayload extends JwtPayload {
  sub: string;
  roles: string[];
  permissions: string[];
  type: 'access';
}

export interface TokenResult {
  token: string;
  expiresAt: Date;
  expiresIn: number;
}

const computeExpiry = (seconds: number): Date => new Date(Date.now() + seconds * 1_000);

const hashRefreshToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

const isAccessTokenPayload = (payload: JwtPayload): payload is AccessTokenPayload =>
  typeof payload.sub === 'string' &&
  payload.type === 'access' &&
  Array.isArray(payload.roles) &&
  Array.isArray(payload.permissions);

interface RefreshTokenPayload extends JwtPayload {
  sub: string;
  type: 'refresh';
}

const isRefreshTokenPayload = (payload: JwtPayload): payload is RefreshTokenPayload =>
  typeof payload.sub === 'string' && payload.type === 'refresh';

export class TokenService {
  private readonly config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
  }

  generateAccessToken(
    userId: string,
    roles: string[],
    permissions: string[],
  ): Promise<TokenResult> {
    const expiresIn = this.config.AUTH_ACCESS_TOKEN_TTL;
    const payload: AccessTokenPayload = {
      sub: userId,
      roles,
      permissions,
      type: 'access',
    };

    const token = jwt.sign(payload, this.config.AUTH_ACCESS_TOKEN_SECRET, {
      algorithm: 'HS256',
      expiresIn,
      audience: 'metrika-api',
      issuer: 'metrika-backend',
    });

    return Promise.resolve({
      token,
      expiresAt: computeExpiry(expiresIn),
      expiresIn,
    });
  }

  verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    const decoded = jwt.verify(token, this.config.AUTH_ACCESS_TOKEN_SECRET, {
      algorithms: ['HS256'],
      audience: 'metrika-api',
      issuer: 'metrika-backend',
    });

    if (typeof decoded === 'string' || !isAccessTokenPayload(decoded)) {
      throw unauthorizedError('Invalid access token');
    }

    return Promise.resolve(decoded);
  }

  generateRefreshToken(): Promise<TokenResult & { tokenHash: string }> {
    const expiresIn = this.config.AUTH_REFRESH_TOKEN_TTL;
    const rawToken = randomBytes(64).toString('hex');
    const payload: RefreshTokenPayload = {
      sub: rawToken,
      type: 'refresh',
      jit: randomBytes(8).toString('hex'),
    };

    const token = jwt.sign(payload, this.config.AUTH_REFRESH_TOKEN_SECRET, {
      algorithm: 'HS256',
      expiresIn,
      audience: 'metrika-api',
      issuer: 'metrika-backend',
    });

    return Promise.resolve({
      token,
      tokenHash: hashRefreshToken(rawToken),
      expiresAt: computeExpiry(expiresIn),
      expiresIn,
    });
  }

  verifyRefreshToken(token: string): Promise<{ raw: string; hash: string }> {
    try {
      const decoded = jwt.verify(token, this.config.AUTH_REFRESH_TOKEN_SECRET, {
        algorithms: ['HS256'],
        audience: 'metrika-api',
        issuer: 'metrika-backend',
      });

      if (typeof decoded === 'string' || !isRefreshTokenPayload(decoded)) {
        throw unauthorizedError('Invalid refresh token');
      }

      return Promise.resolve({
        raw: decoded.sub,
        hash: hashRefreshToken(decoded.sub),
      });
    } catch (error: unknown) {
      throw unauthorizedError('Invalid refresh token', { cause: error });
    }
  }
}
