import request from 'supertest';
import { createApp } from '../../src/http/app';
import { createLogger } from '../../src/lib/logger';
import { asValue, createContainer } from 'awilix';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';

const prisma = new PrismaClient();
const logger = createLogger({ name: 'ApiKeyTest' });

describe('API Key Middleware E2E', () => {
    let app: any;
    let testUser: any;
    let validApiKey: string;
    let validKeyHash: string;

    beforeAll(async () => {
        // Setup container and app
        const container = createContainer();
        container.register({
            logger: asValue(logger),
            config: asValue({} as any), // Mock config
        });

        // Mock routers and middleware
        const mockRouter = require('express').Router();
        mockRouter.get('/protected', (req: any, res: any) => {
            if (req.user) {
                res.json({ success: true, userId: req.user.id });
            } else {
                res.status(401).json({ error: 'Unauthorized' });
            }
        });

        // Create app with mocked dependencies
        app = createApp({
            logger,
            config: {} as any,
            container,
            authRouter: mockRouter,
            userRouter: mockRouter,
            projectRouter: mockRouter,
            projectMembersRouter: mockRouter,
            membersRouter: mockRouter,
            projectTaskRouter: mockRouter,
            projectDocumentRouter: mockRouter,
            documentRouter: mockRouter,
            taskRouter: mockRouter,
            kpiRouter: mockRouter,
            reportsRouter: mockRouter,
            auditRouter: mockRouter,
            queueRouter: mockRouter,
            exportRouter: mockRouter,
            monitoringRouter: mockRouter,
            unsubscribeRouter: mockRouter,
            searchRouter: mockRouter,
            newApiKeysRouter: mockRouter,
            systemSettingsRouter: mockRouter,
            userPreferencesRouter: mockRouter,
            notificationsRouter: mockRouter,
            webhookRouter: mockRouter,
            authMiddleware: (req: any, res: any, next: any) => {
                // If api key middleware already attached user, proceed.
                if (req.user) return next();
                // Otherwise simulate auth failure for protected routes
                res.status(401).json({ error: 'Unauthorized' });
            },
        });

        // Create test user
        testUser = await prisma.user.create({
            data: {
                id: randomUUID(),
                email: `apikey-test-${Date.now()}@example.com`,
                fullName: 'API Key Test User',
                passwordHash: 'hash',
            },
        });

        // Create valid API key
        validApiKey = `sk_test_${randomUUID()}`;
        validKeyHash = createHash('sha256').update(validApiKey).digest('hex');

        await prisma.apiKey.create({
            data: {
                name: 'Test Key',
                keyHash: validKeyHash,
                userId: testUser.id,
                expiresAt: new Date(Date.now() + 1000 * 60 * 60), // 1 hour
            },
        });
    });

    afterAll(async () => {
        await prisma.apiKey.deleteMany({ where: { userId: testUser.id } });
        await prisma.user.delete({ where: { id: testUser.id } });
        await prisma.$disconnect();
    });

    it('should authenticate with valid API key', async () => {
        // We use one of the mounted routes to test. 
        // Since we mocked routers, we can't easily hit a real protected route unless we mount one.
        // But createApp mounts routers. Let's try hitting a route that uses authMiddleware.
        // /api/v1/users is mounted with authMiddleware.
        // Our mock router handles GET /protected? No, we passed mockRouter to all.
        // So GET /api/v1/users/protected should work if we define it on mockRouter.

        const res = await request(app)
            .get('/api/v1/users/protected')
            .set('X-API-KEY', validApiKey);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.userId).toBe(testUser.id);
    });

    it('should fail with invalid API key', async () => {
        const res = await request(app)
            .get('/api/v1/users/protected')
            .set('X-API-KEY', 'invalid-key');

        expect(res.status).toBe(401);
        expect(res.body.errors[0].code).toBe('AUTH_INVALID_API_KEY');
    });

    it('should fail with missing API key (and fall through to authMiddleware which returns 401)', async () => {
        const res = await request(app)
            .get('/api/v1/users/protected');

        expect(res.status).toBe(401);
        // Error comes from authMiddleware mock
        expect(res.body.error).toBe('Unauthorized');
    });
});
