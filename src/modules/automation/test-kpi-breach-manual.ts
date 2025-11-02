/**
 * KPI Breach Check Manuel Test
 * 
 * KPI threshold aşımını test eder ve email gönderimini kontrol eder
 * 
 * Kullanım:
 * npx ts-node src/modules/automation/test-kpi-breach-manual.ts
 * 
 * Önkoşul:
 * - Redis çalışıyor olmalı
 * - MailHog çalışıyor olmalı
 */

import { PrismaClient } from '@prisma/client';
import { kpiBreachCheckCron } from './jobs/kpi-breach-check.cron';
import { createLogger } from '../../lib/logger';
import { randomUUID } from 'crypto';

const logger = createLogger({ name: 'ManualKPIBreachTest' });
const prisma = new PrismaClient();

async function runTest() {
  logger.info('=== KPI Breach Check Manuel Test ===\n');

  try {
    // 1. Test kullanıcısı bul veya oluştur
    let testUser = await prisma.user.findFirst({ where: { email: 'test-kpi@metrika.local' } });
    
    if (!testUser) {
      testUser = await prisma.user.create({
        data: {
          id: randomUUID(),
          email: 'test-kpi@metrika.local',
          fullName: 'Test KPI Steward',
          passwordHash: 'dummy_hash',
          status: 'ACTIVE',
        },
      });
      logger.info('✅ Test user created');
    }

    // 2. Test projesi bul veya oluştur
    let testProject = await prisma.project.findFirst({ where: { code: 'TEST-KPI' } });
    
    if (!testProject) {
      testProject = await prisma.project.create({
        data: {
          id: randomUUID(),
          name: 'Test Project - KPI Breach',
          code: 'TEST-KPI',
          description: 'Test project for KPI breach testing',
          status: 'ACTIVE',
          sponsorId: testUser.id,
          pmoOwnerId: testUser.id,
          startDate: new Date(),
        },
      });
      logger.info('✅ Test project created');
    }

    // 3. KPI Definition bul veya oluştur - CRITICAL threshold düşük tutuyoruz
    let kpiDef = await prisma.kPIDefinition.findUnique({
      where: { code: 'TEST-KPI-BREACH' },
    });

    if (!kpiDef) {
      kpiDef = await prisma.kPIDefinition.create({
        data: {
          id: randomUUID(),
          code: 'TEST-KPI-BREACH',
          name: 'Test KPI - Breach Detection',
          description: 'KPI for testing breach detection and email notifications',
          category: 'QUALITY',
          calculationFormula: 'Manual input',
          unit: 'percent',
          targetValue: 95.0,
          thresholdWarning: 85.0,
          thresholdCritical: 80.0, // DÜŞÜK THRESHOLD - kolay aşılır
          aggregationPeriod: 'WEEKLY',
          dataSourceType: 'MANUAL',
          stewardId: testUser.id,
          approverId: testUser.id,
          status: 'ACTIVE',
          linkedProjectIds: [testProject.id],
        },
      });
      logger.info('✅ KPI Definition created');
    } else {
      // Reset status to ACTIVE for testing
      kpiDef = await prisma.kPIDefinition.update({
        where: { id: kpiDef.id },
        data: { status: 'ACTIVE' },
      });
      logger.info('✅ KPI Definition found and reset to ACTIVE');
    }

    logger.info({
      kpiId: kpiDef.id,
      code: kpiDef.code,
      target: kpiDef.targetValue,
      critical: kpiDef.thresholdCritical,
    }, '✅ KPI Definition created');

    // 4. KPI Series data ekle - CRITICAL threshold'u aşan değer
    const breachValue = 75.0; // 80'in altında = CRITICAL breach
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await prisma.kPISeries.create({
      data: {
        id: randomUUID(),
        kpiId: kpiDef.id,
        actualValue: breachValue,
        periodStart: today,
        periodEnd: today,
        valueSource: 'MANUAL_ENTRY',
        collectedBy: testUser.id,
        verificationStatus: 'VERIFIED',
        verifiedBy: testUser.id,
        verifiedAt: new Date(),
      },
    });

    logger.info({
      value: breachValue,
      threshold: Number(kpiDef.thresholdCritical),
      breach: breachValue < Number(kpiDef.thresholdCritical),
    }, '✅ KPI Series data created (BREACH!)');

    // 5. Cron job'u çalıştır
    logger.info('\n🚀 Running kpi-breach-check cron job...');
    await kpiBreachCheckCron();

    logger.info('\n✅ Test completed successfully!\n');
    logger.info('📧 Next steps:');
    logger.info('1. Check MailHog UI at: http://localhost:8025');
    logger.info('2. Look for email with subject: "🚨 KPI Critical Threshold Breach"');
    logger.info({
      stewardEmail: testUser.email,
      kpiName: kpiDef.name,
      currentValue: breachValue,
      criticalThreshold: Number(kpiDef.thresholdCritical),
      deviation: ((breachValue - Number(kpiDef.thresholdCritical)) / Number(kpiDef.thresholdCritical) * 100).toFixed(2) + '%',
    }, '3. Email details:');
    logger.info('\n⚠️  If no email appears:');
    logger.info('   - Check Redis is running');
    logger.info('   - Check MailHog is running on port 1025/8025');
    logger.info('   - Worker should process kpi-automation queue');

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
