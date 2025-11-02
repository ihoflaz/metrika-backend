/**
 * Task Delay Check Manuel Test
 * 
 * BASIT TEST: Mevcut gecikmiş task'ları bulur ve email gönderir
 * 
 * Kullanım:
 * npx ts-node src/modules/automation/test-delay-manual.ts
 * 
 * Önkoşul:
 * - Redis çalışıyor olmalı
 * - MailHog çalışıyor olmalı
 * - Database'de en az 1 gecikmiş task olmalı
 */

import { PrismaClient } from '@prisma/client';
import { taskDelayCheckCron } from './jobs/task-delay-check.cron';
import { createLogger } from '../../lib/logger';
import { randomUUID } from 'crypto';

const logger = createLogger({ name: 'ManualDelayTest' });
const prisma = new PrismaClient();

async function runTest() {
  logger.info('=== Task Delay Check Manuel Test ===\n');

  try {
    // 1. Önce gecikmiş task var mı kontrol et
    const now = new Date();
    const delayedTasks = await prisma.task.findMany({
      where: {
        OR: [
          {
            status: 'PLANNED',
            plannedStart: {
              lte: new Date(now.getTime() - 24 * 60 * 60 * 1000),
            },
          },
          {
            status: {
              in: ['PLANNED', 'IN_PROGRESS', 'BLOCKED', 'ON_HOLD'],
            },
            plannedEnd: {
              lt: now,
            },
          },
        ],
      },
      include: {
        owner: true,
        project: true,
      },
    });

    logger.info(`Found ${delayedTasks.length} delayed tasks`);

    if (delayedTasks.length === 0) {
      logger.warn('\n⚠️  No delayed tasks found. Creating test data...');
      
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      
      // Find or create test user
      let testUser = await prisma.user.findFirst({ where: { email: 'test-delay@metrika.local' } });
      
      if (!testUser) {
        testUser = await prisma.user.create({
          data: {
            id: randomUUID(),
            email: 'test-delay@metrika.local',
            fullName: 'Test Delay User',
            passwordHash: 'dummy_hash',
            status: 'ACTIVE',
          },
        });
      }
      
      // Find or create test project
      let testProject = await prisma.project.findFirst({ where: { code: 'TEST-DELAY' } });
      
      if (!testProject) {
        testProject = await prisma.project.create({
          data: {
            id: randomUUID(),
            name: 'Test Project - Delay Check',
            code: 'TEST-DELAY',
            description: 'Test project for delay check',
            status: 'ACTIVE',
            sponsorId: testUser.id,
            pmoOwnerId: testUser.id,
            startDate: new Date(),
          },
        });
      }

      // Create delayed task
      await prisma.task.create({
        data: {
          id: randomUUID(),
          title: '[TEST] Delayed Task - Email Test',
          description: 'This is a delayed task for testing email notifications',
          status: 'IN_PROGRESS',
          priority: 'HIGH',
          projectId: testProject.id,
          ownerId: testUser.id,
          reporterId: testUser.id,
          plannedEnd: threeDaysAgo,
        },
      });

      logger.info({ 
        userEmail: testUser.email,
        projectCode: testProject.code,
        plannedEnd: threeDaysAgo,
      }, '✅ Test data created');
    }

    // 2. Cron job'u çalıştır
    logger.info('\n🚀 Running task-delay-check cron job...');
    await taskDelayCheckCron();

    logger.info('\n✅ Test completed successfully!\n');
    logger.info('📧 Next steps:');
    logger.info('1. Check MailHog UI at: http://localhost:8025');
    logger.info('2. Look for email with subject containing: "Task Reminder"');
    logger.info('3. Task automation queue should have new jobs');
    logger.info('\n⚠️  If no email appears:');
    logger.info('   - Check Redis is running (queue needs it)');
    logger.info('   - Check MailHog is running on port 1025/8025');
    logger.info('   - Worker should process notification queue automatically');

  } catch (error) {
    logger.error({ 
      error: error instanceof Error ? { message: error.message, stack: error.stack } : error 
    }, '❌ Test failed');
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Test başlat
runTest()
  .then(() => {
    logger.info('\n✅ Test başarılı');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test başarısız:', error);
    process.exit(1);
  });
