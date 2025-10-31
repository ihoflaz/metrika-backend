import { SignJWT, jwtVerify } from 'jose/dist/node/cjs';
import type { JWTPayload } from 'jose';
import { createHash, randomBytes } from 'node:crypto';
import type { AppConfig } from '../../config/app-config';
import { unauthorizedError } from '../../common/errors';

export interface AccessTokenPayload extends JWTPayload {
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

const encoder = new TextEncoder();

const computeExpiry = (seconds: number): Date => new Date(Date.now() + seconds * 1000);

const hashRefreshToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export class TokenService {
  private readonly config: AppConfig;

  private readonly accessSecret: Uint8Array;

  private readonly refreshSecret: Uint8Array;

  constructor(config: AppConfig) {
    this.config = config;
    this.accessSecret = encoder.encode(config.AUTH_ACCESS_TOKEN_SECRET);
    this.refreshSecret = encoder.encode(config.AUTH_REFRESH_TOKEN_SECRET);
  }

  async generateAccessToken(
    userId: string,
    roles: string[],
    permissions: string[],
  ): Promise<TokenResult> {
    const expiresIn = this.config.AUTH_ACCESS_TOKEN_TTL;
    const expiresAt = computeExpiry(expiresIn);
    const token = await new SignJWT({
      sub: userId,
      roles,
      permissions,
      type: 'access',
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .setAudience('metrika-api')
      .setIssuer('metrika-backend')
      .sign(this.accessSecret);

    return { token, expiresAt, expiresIn };
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    const { payload } = await jwtVerify<AccessTokenPayload>(token, this.accessSecret, {
      audience: 'metrika-api',
      issuer: 'metrika-backend',
    });

    if (payload.type !== 'access' || typeof payload.sub !== 'string') {
      throw unauthorizedError('Invalid access token');
    }

    return payload;
  }

  async generateRefreshToken(): Promise<TokenResult & { tokenHash: string }> {
    const expiresIn = this.config.AUTH_REFRESH_TOKEN_TTL;
    const expiresAt = computeExpiry(expiresIn);
    const rawToken = randomBytes(64).toString('hex');
    const token = await new SignJWT({
      jit: randomBytes(8).toString('hex'),
      type: 'refresh',
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .setAudience('metrika-api')
      .setIssuer('metrika-backend')
      .setSubject(rawToken)
      .sign(this.refreshSecret);

    return {
      token,
      tokenHash: hashRefreshToken(rawToken),
      expiresAt,
      expiresIn,
    };
  }

  async verifyRefreshToken(token: string): Promise<{ raw: string; hash: string }> {
    try {
      const { payload } = await jwtVerify<JWTPayload>(token, this.refreshSecret, {
        audience: 'metrika-api',
        issuer: 'metrika-backend',
      });

      if (payload.type !== 'refresh' || typeof payload.sub !== 'string') {
        throw unauthorizedError('Invalid refresh token');
      }

      return {
        raw: payload.sub,
        hash: hashRefreshToken(payload.sub),
      };
    } catch (error: unknown) {
      throw unauthorizedError('Invalid refresh token', { cause: error });
    }
  }
}
