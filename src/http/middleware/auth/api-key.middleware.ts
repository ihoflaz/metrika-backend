import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { createLogger } from '../../../lib/logger';
import { createHash } from 'crypto';

const prisma = new PrismaClient();
const logger = createLogger({ name: 'ApiKeyMiddleware' });

export const apiKeyMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    const apiKeyHeader = req.headers['x-api-key'];

    if (!apiKeyHeader || typeof apiKeyHeader !== 'string') {
        // API key yoksa, diğer auth yöntemlerine (JWT) şans ver veya 401 dön
        // Burada "API key zorunlu değil, varsa doğrula" stratejisi izliyoruz.
        // Eğer endpoint kesinlikle API key gerektiriyorsa, route seviyesinde kontrol edilmeli.
        // Ancak "API Key Authentication" görevi genelde API key ile girişi desteklemek demektir.
        // Eğer header varsa ve geçersizse 401 dönmeliyiz.
        return next();
    }

    try {
        // Key formatı: sk_live_...
        // DB'de hashli tutuluyor.
        // Gelen key'i hashle ve ara.

        // NOT: Key'in kendisi DB'de yok, hash'i var.
        // Key üretilirken kullanıcıya verilir, sonra hashlenip saklanır.
        // Burada gelen key'i hashleyip DB'de arayacağız.
        // Hash algoritması: SHA256 (CreateApiKey servisine bakarak emin olunmalı, varsayım SHA256)

        const keyHash = createHash('sha256').update(apiKeyHeader).digest('hex');

        const apiKey = await prisma.apiKey.findUnique({
            where: { keyHash },
            include: { user: true }
        });

        if (!apiKey) {
            logger.warn({ ip: req.ip }, 'Invalid API key provided');
            return res.status(401).json({
                errors: [{
                    code: 'AUTH_INVALID_API_KEY',
                    title: 'Invalid API Key',
                    detail: 'The provided API key is invalid or has been revoked.'
                }]
            });
        }

        if (apiKey.revokedAt) {
            logger.warn({ keyId: apiKey.id, userId: apiKey.userId }, 'Revoked API key used');
            return res.status(401).json({
                errors: [{
                    code: 'AUTH_API_KEY_REVOKED',
                    title: 'API Key Revoked',
                    detail: 'The provided API key has been revoked.'
                }]
            });
        }

        if (new Date() > apiKey.expiresAt) {
            logger.warn({ keyId: apiKey.id, userId: apiKey.userId }, 'Expired API key used');
            return res.status(401).json({
                errors: [{
                    code: 'AUTH_API_KEY_EXPIRED',
                    title: 'API Key Expired',
                    detail: 'The provided API key has expired.'
                }]
            });
        }

        // Update last used at (async, don't wait)
        prisma.apiKey.update({
            where: { id: apiKey.id },
            data: { lastUsedAt: new Date() }
        }).catch(err => logger.error({ err }, 'Failed to update API key lastUsedAt'));

        // Attach user to request
        // @ts-ignore - Express Request type extension needed
        req.user = apiKey.user;
        // @ts-ignore
        req.authMethod = 'api-key';
        // @ts-ignore
        req.apiKeyScopes = apiKey.scopes;

        logger.info({ userId: apiKey.userId, keyId: apiKey.id }, 'API key authentication successful');
        next();

    } catch (error) {
        logger.error({ error }, 'API key authentication error');
        return res.status(500).json({
            errors: [{
                code: 'INTERNAL_SERVER_ERROR',
                title: 'Internal Server Error',
                detail: 'An error occurred during API key authentication.'
            }]
        });
    }
};
