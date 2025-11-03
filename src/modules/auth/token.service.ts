import { createHash, randomBytes } from 'node:crypto';
import jwt, { type JwtPayload, type VerifyOptions } from 'jsonwebtoken';
import type { AppConfig } from '../../config/app-config';
import { isAppError, unauthorizedError } from '../../common/errors';

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

  private readonly accessTokenSecrets: string[];

  private readonly refreshTokenSecrets: string[];

  private readonly refreshTokenRateLimit = new Map<string, { count: number; firstFailure: number }>();

  private readonly refreshTokenMaxAttempts: number;

  private readonly refreshTokenWindowMs: number;

  constructor(config: AppConfig) {
    this.config = config;
    this.accessTokenSecrets = this.buildSecretRotationList(
      config.AUTH_ACCESS_TOKEN_SECRET,
      config.AUTH_ACCESS_TOKEN_SECRET_FALLBACKS,
    );
    this.refreshTokenSecrets = this.buildSecretRotationList(
      config.AUTH_REFRESH_TOKEN_SECRET,
      config.AUTH_REFRESH_TOKEN_SECRET_FALLBACKS,
    );
    this.refreshTokenMaxAttempts = config.AUTH_TOKEN_RATE_LIMIT_MAX_ATTEMPTS;
    this.refreshTokenWindowMs = config.AUTH_TOKEN_RATE_LIMIT_WINDOW_MS;
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

    const token = jwt.sign(payload, this.accessTokenSecrets[0], {
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
    const decoded = this.verifyJwt(
      token,
      this.accessTokenSecrets,
      {
        algorithms: ['HS256'],
        audience: 'metrika-api',
        issuer: 'metrika-backend',
      },
      isAccessTokenPayload,
      'Invalid access token',
    );

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
    const throttleKey = this.computeThrottleKey(token);
    this.ensureRefreshTokenNotRateLimited(throttleKey);

    try {
      const decoded = this.verifyJwt(
        token,
        this.refreshTokenSecrets,
        {
          algorithms: ['HS256'],
          audience: 'metrika-api',
          issuer: 'metrika-backend',
        },
        isRefreshTokenPayload,
        'Invalid refresh token',
      );

      this.clearRefreshTokenFailures(throttleKey);

      return Promise.resolve({
        raw: decoded.sub,
        hash: hashRefreshToken(decoded.sub),
      });
    } catch (error: unknown) {
      this.recordRefreshTokenFailure(throttleKey);
      if (isAppError(error)) {
        throw error;
      }
      throw unauthorizedError('Invalid refresh token', { cause: error });
    }
  }

  private buildSecretRotationList(primary: string, fallbacks?: string | string[]): string[] {
    const fallbackList = Array.isArray(fallbacks)
      ? fallbacks
      : typeof fallbacks === 'string'
        ? fallbacks
            .split(',')
            .map((value) => value.trim())
            .filter((value) => value.length > 0)
        : [];

    const secrets = [primary, ...fallbackList];
    return secrets.filter((secret, index) => secrets.indexOf(secret) === index);
  }

  private verifyJwt<Payload extends JwtPayload>(
    token: string,
    secrets: string[],
    options: VerifyOptions,
    guard: (payload: JwtPayload) => payload is Payload,
    errorMessage: string,
  ): Payload {
    let lastError: unknown;

    for (const secret of secrets) {
      try {
        const decoded = jwt.verify(token, secret, options);
        if (typeof decoded === 'string' || !guard(decoded)) {
          throw unauthorizedError(errorMessage);
        }
        return decoded;
      } catch (error: unknown) {
        if (
          error instanceof Error &&
          (error.name === 'TokenExpiredError' || error.name === 'NotBeforeError')
        ) {
          throw unauthorizedError(errorMessage, { cause: error });
        }
        lastError = error;
      }
    }

    throw unauthorizedError(errorMessage, { cause: lastError });
  }

  private computeThrottleKey(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private ensureRefreshTokenNotRateLimited(key: string) {
    const entry = this.refreshTokenRateLimit.get(key);
    if (!entry) {
      return;
    }

    const now = Date.now();
    if (now - entry.firstFailure > this.refreshTokenWindowMs) {
      this.refreshTokenRateLimit.delete(key);
      return;
    }

    if (entry.count >= this.refreshTokenMaxAttempts) {
      throw unauthorizedError('Too many invalid refresh token attempts. Please try again later.');
    }
  }

  private recordRefreshTokenFailure(key: string) {
    const now = Date.now();
    const entry = this.refreshTokenRateLimit.get(key);

    if (!entry || now - entry.firstFailure > this.refreshTokenWindowMs) {
      this.refreshTokenRateLimit.set(key, { count: 1, firstFailure: now });
      return;
    }

    entry.count += 1;
    this.refreshTokenRateLimit.set(key, entry);
  }

  private clearRefreshTokenFailures(key: string) {
    this.refreshTokenRateLimit.delete(key);
  }
}
