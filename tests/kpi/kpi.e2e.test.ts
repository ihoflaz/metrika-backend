import { PrismaClient, UserStatus, KPIStatus, KPICategory } from '@prisma/client';
import { uuidv7 } from 'uuidv7';
import { setupTestApp, teardownTestApp, type TestAppContext } from '../utils/test-app';
import { hashPassword } from '../../src/modules/auth/password.service';
import { ROLES } from '../../src/modules/rbac/permissions';

describe('KPI API', () => {
  let context!: TestAppContext;
  let prisma!: PrismaClient;
  let pmoToken!: string;
  let projectManagerToken!: string;
  let teamMemberToken!: string;
  let stewardId!: string;
  let approverId!: string;
  let projectId!: string;

  const createUserWithRole = async (
    roleCode: string,
    overrides: Partial<{ email: string; fullName: string; password: string }> = {},
  ) => {
    const password = overrides.password ?? 'SecurePass123!';
    const passwordHash = await hashPassword(password);
    const userId = uuidv7();

    const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });

    await prisma.user.create({
      data: {
        id: userId,
        email: overrides.email ?? `${roleCode.toLowerCase()}@metrika.local`,
        fullName: overrides.fullName ?? `${roleCode} User`,
        passwordHash,
        status: UserStatus.ACTIVE,
        roles: {
          create: {
            role: {
              connect: { id: role.id },
            },
          },
        },
      },
    });

    return {
      id: userId,
      email: overrides.email ?? `${roleCode.toLowerCase()}@metrika.local`,
      password,
    };
  };

  const login = async (credentials: { email: string; password: string }) => {
    const response = await context.httpClient.post('/api/v1/auth/login').send(credentials);
    expect(response.status).toBe(200);
    return response.body.data.attributes.accessToken as string;
  };

  beforeAll(async () => {
    context = await setupTestApp();
    prisma = context.prisma;

    // PMO kullanıcısı (KPI oluşturabilir)
    const pmoCredentials = await createUserWithRole(ROLES.PMO, {
      email: 'pmo-kpi@metrika.local',
      fullName: 'PMO KPI User',
    });
    pmoToken = await login(pmoCredentials);
    stewardId = pmoCredentials.id;

    // Proje yöneticisi (KPI oluşturabilir)
    const pmCredentials = await createUserWithRole(ROLES.PROJECT_MANAGER, {
      email: 'pm-kpi@metrika.local',
      fullName: 'PM KPI User',
    });
    projectManagerToken = await login(pmCredentials);
    approverId = pmCredentials.id;

    // Takım üyesi (sadece KPI okuyabilir)
    const tmCredentials = await createUserWithRole(ROLES.TEAM_MEMBER, {
      email: 'tm-kpi@metrika.local',
      fullName: 'TM KPI User',
    });
    teamMemberToken = await login(tmCredentials);

    // Test projesi oluştur
    const project = await prisma.project.create({
      data: {
        id: uuidv7(),
        code: 'KPI-TEST-PRJ',
        name: 'KPI Test Projesi',
        description: 'KPI testleri için proje',
        status: 'ACTIVE',
        startDate: new Date(),
        sponsorId: stewardId,
        pmoOwnerId: approverId,
      },
    });
    projectId = project.id;
  });

  afterAll(async () => {
    await teardownTestApp(context);
  });

  describe('POST /api/v1/kpis - KPI Oluşturma', () => {
    it('geçerli KPI oluşturulabilmeli', async () => {
      const response = await context.httpClient
        .post('/api/v1/kpis')
        .set('Authorization', `Bearer ${pmoToken}`)
        .send({
          code: 'CPI-001',
          name: 'Maliyet Performans İndeksi',
          description: 'EV / AC oranı',
          category: 'FINANCIAL',
          calculationFormula: 'earnedValue / actualCost',
          targetValue: 1.0,
          unit: 'oran',
          thresholdWarning: 10,
          thresholdCritical: 20,
          aggregationPeriod: 'MONTHLY',
          dataSourceType: 'MANUAL',
          stewardId: stewardId,
          approverId: approverId,
          privacyLevel: 'INTERNAL',
          linkedProjectIds: [projectId],
        });

      expect(response.status).toBe(201);
      expect(response.body.data).toMatchObject({
        type: 'kpi',
        attributes: {
          code: 'CPI-001',
          name: 'Maliyet Performans İndeksi',
          category: 'FINANCIAL',
          status: 'PROPOSED',
        },
      });
      expect(response.body.data.relationships.steward).toBeDefined();
      expect(response.body.data.relationships.approver).toBeDefined();
    });

    it('tehlikeli formül reddedilmeli (eval)', async () => {
      const response = await context.httpClient
        .post('/api/v1/kpis')
        .set('Authorization', `Bearer ${pmoToken}`)
        .send({
          code: 'MALICIOUS-001',
          name: 'Kötü Amaçlı KPI',
          category: 'CUSTOM',
          calculationFormula: 'eval("malicious code")',
          targetValue: 100,
          unit: 'test',
          aggregationPeriod: 'MONTHLY',
          dataSourceType: 'MANUAL',
          stewardId: stewardId,
        });

      expect(response.status).toBe(400);
      expect(response.body.errors).toBeDefined();
    });

    it('tehlikeli formül reddedilmeli (require)', async () => {
      const response = await context.httpClient
        .post('/api/v1/kpis')
        .set('Authorization', `Bearer ${pmoToken}`)
        .send({
          code: 'MALICIOUS-002',
          name: 'Kötü Amaçlı KPI',
          category: 'CUSTOM',
          calculationFormula: 'require("fs")',
          targetValue: 100,
          unit: 'test',
          aggregationPeriod: 'MONTHLY',
          dataSourceType: 'MANUAL',
          stewardId: stewardId,
        });

      expect(response.status).toBe(400);
      expect(response.body.errors).toBeDefined();
    });

    it('duplicate kod reddedilmeli', async () => {
      // İlk KPI'ı oluştur
      await context.httpClient
        .post('/api/v1/kpis')
        .set('Authorization', `Bearer ${pmoToken}`)
        .send({
          code: 'DUP-001',
          name: 'Duplicate Test KPI',
          category: 'QUALITY',
          calculationFormula: 'defectCount / totalTests',
          targetValue: 0.05,
          unit: 'oran',
          aggregationPeriod: 'WEEKLY',
          dataSourceType: 'SYSTEM',
          stewardId: stewardId,
        });

      // Aynı kodu tekrar kullan
      const response = await context.httpClient
        .post('/api/v1/kpis')
        .set('Authorization', `Bearer ${pmoToken}`)
        .send({
          code: 'DUP-001',
          name: 'Duplicate Test KPI 2',
          category: 'QUALITY',
          calculationFormula: 'defectCount / totalTests',
          targetValue: 0.05,
          unit: 'oran',
          aggregationPeriod: 'WEEKLY',
          dataSourceType: 'SYSTEM',
          stewardId: stewardId,
        });

      expect(response.status).toBe(409);
      expect(response.body.errors).toBeDefined();
    });

    it('yetki olmadan KPI oluşturulamamalı', async () => {
      const response = await context.httpClient
        .post('/api/v1/kpis')
        .set('Authorization', `Bearer ${teamMemberToken}`)
        .send({
          code: 'UNAUTH-001',
          name: 'Unauthorized KPI',
          category: 'CUSTOM',
          calculationFormula: 'value * 2',
          targetValue: 100,
          unit: 'test',
          aggregationPeriod: 'MONTHLY',
          dataSourceType: 'MANUAL',
          stewardId: stewardId,
        });

      expect(response.status).toBe(403);
    });
  });

  describe('GET /api/v1/kpis - KPI Listeleme', () => {
    beforeAll(async () => {
      // Test verileri oluştur
      await prisma.kPIDefinition.createMany({
        data: [
          {
            id: uuidv7(),
            code: 'SPI-001',
            name: 'Zaman Performans İndeksi',
            category: KPICategory.SCHEDULE,
            calculationFormula: 'earnedValue / plannedValue',
            targetValue: 1.0,
            unit: 'oran',
            aggregationPeriod: 'MONTHLY',
            dataSourceType: 'MANUAL',
            status: KPIStatus.ACTIVE,
            stewardId: stewardId,
            privacyLevel: 'INTERNAL',
          },
          {
            id: uuidv7(),
            code: 'QPI-001',
            name: 'Kalite İndeksi',
            category: KPICategory.QUALITY,
            calculationFormula: 'passedTests / totalTests',
            targetValue: 0.95,
            unit: 'oran',
            aggregationPeriod: 'WEEKLY',
            dataSourceType: 'SYSTEM',
            status: KPIStatus.MONITORING,
            stewardId: stewardId,
            privacyLevel: 'PUBLIC',
          },
        ],
      });
    });

    it('tüm KPI\'lar listelenebilmeli', async () => {
      const response = await context.httpClient
        .get('/api/v1/kpis')
        .set('Authorization', `Bearer ${pmoToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data.length).toBeGreaterThanOrEqual(2);
      expect(response.body.meta.total).toBeGreaterThanOrEqual(2);
    });

    it('kategoriye göre filtrelenebilmeli', async () => {
      const response = await context.httpClient
        .get('/api/v1/kpis?category=FINANCIAL')
        .set('Authorization', `Bearer ${pmoToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toBeInstanceOf(Array);
      response.body.data.forEach((kpi: any) => {
        expect(kpi.attributes.category).toBe('FINANCIAL');
      });
    });

    it('duruma göre filtrelenebilmeli', async () => {
      const response = await context.httpClient
        .get('/api/v1/kpis?status=ACTIVE')
        .set('Authorization', `Bearer ${pmoToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toBeInstanceOf(Array);
      response.body.data.forEach((kpi: any) => {
        expect(kpi.attributes.status).toBe('ACTIVE');
      });
    });

    it('arama yapılabilmeli', async () => {
      const response = await context.httpClient
        .get('/api/v1/kpis?search=performans')
        .set('Authorization', `Bearer ${pmoToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('GET /api/v1/kpis/:kpiId - KPI Detay', () => {
    let testKpiId: string;

    beforeAll(async () => {
      const kpi = await prisma.kPIDefinition.create({
        data: {
          id: uuidv7(),
          code: 'DETAIL-001',
          name: 'Detay Test KPI',
          category: KPICategory.RESOURCE,
          calculationFormula: 'utilizedHours / availableHours',
          targetValue: 0.8,
          unit: 'oran',
          aggregationPeriod: 'MONTHLY',
          dataSourceType: 'MANUAL',
          status: KPIStatus.ACTIVE,
          stewardId: stewardId,
          privacyLevel: 'INTERNAL',
        },
      });
      testKpiId = kpi.id;

      // Test veri noktası ekle
      await prisma.kPISeries.create({
        data: {
          id: uuidv7(),
          kpiId: testKpiId,
          periodStart: new Date('2025-10-01'),
          periodEnd: new Date('2025-10-31'),
          actualValue: 0.75,
          valueSource: 'MANUAL_ENTRY',
          collectedBy: stewardId,
        },
      });
    });

    it('KPI detayı alınabilmeli', async () => {
      const response = await context.httpClient
        .get(`/api/v1/kpis/${testKpiId}`)
        .set('Authorization', `Bearer ${pmoToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.id).toBe(testKpiId);
      expect(response.body.data.attributes.code).toBe('DETAIL-001');
      expect(response.body.data.relationships.latestDataPoint).toBeDefined();
      expect(response.body.data.relationships.latestDataPoint.attributes.actualValue).toBe('0.75');
    });

    it('olmayan KPI 404 döndürmeli', async () => {
      const response = await context.httpClient
        .get(`/api/v1/kpis/${uuidv7()}`)
        .set('Authorization', `Bearer ${pmoToken}`);

      expect(response.status).toBe(404);
    });
  });

  describe('PATCH /api/v1/kpis/:kpiId - KPI Güncelleme', () => {
    let testKpiId: string;

    beforeAll(async () => {
      const kpi = await prisma.kPIDefinition.create({
        data: {
          id: uuidv7(),
          code: 'UPDATE-001',
          name: 'Update Test KPI',
          category: KPICategory.COMPLIANCE,
          calculationFormula: 'compliantItems / totalItems',
          targetValue: 1.0,
          unit: 'oran',
          aggregationPeriod: 'QUARTERLY',
          dataSourceType: 'MANUAL',
          status: KPIStatus.PROPOSED,
          stewardId: stewardId,
          privacyLevel: 'RESTRICTED',
        },
      });
      testKpiId = kpi.id;
    });

    it('KPI güncellenebilmeli', async () => {
      const response = await context.httpClient
        .patch(`/api/v1/kpis/${testKpiId}`)
        .set('Authorization', `Bearer ${pmoToken}`)
        .send({
          name: 'Updated KPI Name',
          targetValue: 0.98,
          status: 'ACTIVE',
        });

      expect(response.status).toBe(200);
      expect(response.body.data.attributes.name).toBe('Updated KPI Name');
      expect(response.body.data.attributes.targetValue).toBe('0.98');
      expect(response.body.data.attributes.status).toBe('ACTIVE');
    });

    it('yeni formül güvenlik kontrolünden geçmeli', async () => {
      const response = await context.httpClient
        .patch(`/api/v1/kpis/${testKpiId}`)
        .set('Authorization', `Bearer ${pmoToken}`)
        .send({
          calculationFormula: 'function() { return malicious; }',
        });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/v1/kpis/:kpiId/retire - KPI Emekliye Ayırma', () => {
    let testKpiId: string;

    beforeAll(async () => {
      const kpi = await prisma.kPIDefinition.create({
        data: {
          id: uuidv7(),
          code: 'RETIRE-001',
          name: 'Retire Test KPI',
          category: KPICategory.CUSTOM,
          calculationFormula: 'oldMetric * factor',
          targetValue: 100,
          unit: 'adet',
          aggregationPeriod: 'YEARLY',
          dataSourceType: 'SYSTEM',
          status: KPIStatus.ACTIVE,
          stewardId: stewardId,
          privacyLevel: 'PUBLIC',
        },
      });
      testKpiId = kpi.id;
    });

    it('KPI emekliye ayrılabilmeli', async () => {
      const response = await context.httpClient
        .post(`/api/v1/kpis/${testKpiId}/retire`)
        .set('Authorization', `Bearer ${pmoToken}`)
        .send();

      expect(response.status).toBe(200);
      expect(response.body.data.attributes.status).toBe('RETIRED');
    });

    it('zaten retired KPI tekrar retired edilememeli', async () => {
      const response = await context.httpClient
        .post(`/api/v1/kpis/${testKpiId}/retire`)
        .set('Authorization', `Bearer ${pmoToken}`)
        .send();

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/v1/kpis/:kpiId/values - Veri Noktası Ekleme', () => {
    let testKpiId: string;

    beforeAll(async () => {
      const kpi = await prisma.kPIDefinition.create({
        data: {
          id: uuidv7(),
          code: 'DATA-001',
          name: 'Data Point Test KPI',
          category: KPICategory.SCHEDULE,
          calculationFormula: 'completedTasks / totalTasks',
          targetValue: 0.9,
          unit: 'oran',
          aggregationPeriod: 'WEEKLY',
          dataSourceType: 'MANUAL',
          status: KPIStatus.ACTIVE,
          stewardId: stewardId,
          privacyLevel: 'INTERNAL',
        },
      });
      testKpiId = kpi.id;
    });

    it('veri noktası eklenebilmeli', async () => {
      const response = await context.httpClient
        .post(`/api/v1/kpis/${testKpiId}/values`)
        .set('Authorization', `Bearer ${pmoToken}`)
        .send({
          periodStart: '2025-11-01T00:00:00Z',
          periodEnd: '2025-11-07T23:59:59Z',
          actualValue: 0.85,
          valueSource: 'MANUAL_ENTRY',
          collectedBy: stewardId,
          verificationNotes: 'Manuel olarak girildi',
        });

      expect(response.status).toBe(201);
      expect(response.body.data.type).toBe('kpi-data');
      expect(response.body.data.attributes.actualValue).toBe('0.85');
      expect(response.body.data.attributes.valueSource).toBe('MANUAL_ENTRY');
    });

    it('çakışan periyot reddedilmeli', async () => {
      // İlk veri noktası
      await context.httpClient
        .post(`/api/v1/kpis/${testKpiId}/values`)
        .set('Authorization', `Bearer ${pmoToken}`)
        .send({
          periodStart: '2025-11-08T00:00:00Z',
          periodEnd: '2025-11-14T23:59:59Z',
          actualValue: 0.88,
          valueSource: 'MANUAL_ENTRY',
        });

      // Çakışan periyot
      const response = await context.httpClient
        .post(`/api/v1/kpis/${testKpiId}/values`)
        .set('Authorization', `Bearer ${pmoToken}`)
        .send({
          periodStart: '2025-11-10T00:00:00Z',
          periodEnd: '2025-11-16T23:59:59Z',
          actualValue: 0.90,
          valueSource: 'MANUAL_ENTRY',
        });

      expect(response.status).toBe(400);
      expect(response.body.errors).toBeDefined();
    });
  });

  describe('GET /api/v1/kpis/:kpiId/trend - Trend Analizi', () => {
    let testKpiId: string;

    beforeAll(async () => {
      const kpi = await prisma.kPIDefinition.create({
        data: {
          id: uuidv7(),
          code: 'TREND-001',
          name: 'Trend Test KPI',
          category: KPICategory.QUALITY,
          calculationFormula: 'passedTests / totalTests',
          targetValue: 0.95,
          unit: 'oran',
          thresholdWarning: 5,
          thresholdCritical: 10,
          aggregationPeriod: 'MONTHLY',
          dataSourceType: 'SYSTEM',
          status: KPIStatus.MONITORING,
          stewardId: stewardId,
          privacyLevel: 'PUBLIC',
        },
      });
      testKpiId = kpi.id;

      // Birden fazla veri noktası ekle
      const dataPoints = [
        { periodStart: '2025-01-01', periodEnd: '2025-01-31', actualValue: 0.92 },
        { periodStart: '2025-02-01', periodEnd: '2025-02-28', actualValue: 0.94 },
        { periodStart: '2025-03-01', periodEnd: '2025-03-31', actualValue: 0.96 },
        { periodStart: '2025-04-01', periodEnd: '2025-04-30', actualValue: 0.95 },
        { periodStart: '2025-05-01', periodEnd: '2025-05-31', actualValue: 0.97 },
      ];

      for (const dp of dataPoints) {
        await prisma.kPISeries.create({
          data: {
            id: uuidv7(),
            kpiId: testKpiId,
            periodStart: new Date(dp.periodStart),
            periodEnd: new Date(dp.periodEnd),
            actualValue: dp.actualValue,
            valueSource: 'API_INGEST',
            collectedBy: stewardId,
          },
        });
      }
    });

    it('trend analizi alınabilmeli', async () => {
      const response = await context.httpClient
        .get(`/api/v1/kpis/${testKpiId}/trend`)
        .set('Authorization', `Bearer ${pmoToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.type).toBe('kpi-trend');
      expect(response.body.data.attributes.statistics).toBeDefined();
      expect(response.body.data.attributes.statistics.average).toBeGreaterThan(0);
      expect(response.body.data.attributes.statistics.minimum).toBeGreaterThan(0);
      expect(response.body.data.attributes.statistics.maximum).toBeGreaterThan(0);
      expect(response.body.data.relationships.dataPoints).toBeInstanceOf(Array);
      expect(response.body.data.relationships.dataPoints.length).toBe(5);
    });

    it('limit parametresi çalışmalı', async () => {
      const response = await context.httpClient
        .get(`/api/v1/kpis/${testKpiId}/trend?limit=3`)
        .set('Authorization', `Bearer ${pmoToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.relationships.dataPoints.length).toBe(3);
    });
  });

  describe('GET /api/v1/kpis/:kpiId/threshold-check - Eşik Kontrolü', () => {
    let warningKpiId: string;
    let criticalKpiId: string;
    let okKpiId: string;

    beforeAll(async () => {
      // Warning eşiğini aşan KPI
      const warningKpi = await prisma.kPIDefinition.create({
        data: {
          id: uuidv7(),
          code: 'THRESHOLD-WARN',
          name: 'Warning Threshold KPI',
          category: KPICategory.FINANCIAL,
          calculationFormula: 'actualCost / budget',
          targetValue: 1.0,
          unit: 'oran',
          thresholdWarning: 5,
          thresholdCritical: 15,
          aggregationPeriod: 'MONTHLY',
          dataSourceType: 'MANUAL',
          status: KPIStatus.MONITORING,
          stewardId: stewardId,
          privacyLevel: 'INTERNAL',
        },
      });
      warningKpiId = warningKpi.id;

      await prisma.kPISeries.create({
        data: {
          id: uuidv7(),
          kpiId: warningKpiId,
          periodStart: new Date('2025-10-01'),
          periodEnd: new Date('2025-10-31'),
          actualValue: 1.08, // %8 sapma - warning eşiğini aşıyor
          valueSource: 'MANUAL_ENTRY',
          collectedBy: stewardId,
        },
      });

      // Critical eşiğini aşan KPI
      const criticalKpi = await prisma.kPIDefinition.create({
        data: {
          id: uuidv7(),
          code: 'THRESHOLD-CRIT',
          name: 'Critical Threshold KPI',
          category: KPICategory.SCHEDULE,
          calculationFormula: 'actualDuration / plannedDuration',
          targetValue: 1.0,
          unit: 'oran',
          thresholdWarning: 10,
          thresholdCritical: 20,
          aggregationPeriod: 'MONTHLY',
          dataSourceType: 'SYSTEM',
          status: KPIStatus.MONITORING,
          stewardId: stewardId,
          privacyLevel: 'PUBLIC',
        },
      });
      criticalKpiId = criticalKpi.id;

      await prisma.kPISeries.create({
        data: {
          id: uuidv7(),
          kpiId: criticalKpiId,
          periodStart: new Date('2025-10-01'),
          periodEnd: new Date('2025-10-31'),
          actualValue: 1.25, // %25 sapma - critical eşiğini aşıyor
          valueSource: 'API_INGEST',
          collectedBy: stewardId,
        },
      });

      // Normal KPI (eşikleri aşmayan)
      const okKpi = await prisma.kPIDefinition.create({
        data: {
          id: uuidv7(),
          code: 'THRESHOLD-OK',
          name: 'OK Threshold KPI',
          category: KPICategory.QUALITY,
          calculationFormula: 'qualityScore',
          targetValue: 100,
          unit: 'puan',
          thresholdWarning: 10,
          thresholdCritical: 20,
          aggregationPeriod: 'WEEKLY',
          dataSourceType: 'MANUAL',
          status: KPIStatus.ACTIVE,
          stewardId: stewardId,
          privacyLevel: 'PUBLIC',
        },
      });
      okKpiId = okKpi.id;

      await prisma.kPISeries.create({
        data: {
          id: uuidv7(),
          kpiId: okKpiId,
          periodStart: new Date('2025-10-28'),
          periodEnd: new Date('2025-11-03'),
          actualValue: 98, // %2 sapma - eşikleri aşmıyor
          valueSource: 'MANUAL_ENTRY',
          collectedBy: stewardId,
        },
      });
    });

    it('warning eşiği tespit edilmeli', async () => {
      const response = await context.httpClient
        .get(`/api/v1/kpis/${warningKpiId}/threshold-check`)
        .set('Authorization', `Bearer ${pmoToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.attributes.exceedsWarning).toBe(true);
      expect(response.body.data.attributes.exceedsCritical).toBe(false);
      expect(response.body.data.attributes.currentValue).toBe('1.08');
      expect(response.body.data.attributes.deviation).toBeCloseTo(8, 1);
    });

    it('critical eşiği tespit edilmeli', async () => {
      const response = await context.httpClient
        .get(`/api/v1/kpis/${criticalKpiId}/threshold-check`)
        .set('Authorization', `Bearer ${pmoToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.attributes.exceedsWarning).toBe(true);
      expect(response.body.data.attributes.exceedsCritical).toBe(true);
      expect(response.body.data.attributes.currentValue).toBe('1.25');
      expect(response.body.data.attributes.deviation).toBeCloseTo(25, 1);
    });

    it('normal KPI eşikleri aşmamalı', async () => {
      const response = await context.httpClient
        .get(`/api/v1/kpis/${okKpiId}/threshold-check`)
        .set('Authorization', `Bearer ${pmoToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.attributes.exceedsWarning).toBe(false);
      expect(response.body.data.attributes.exceedsCritical).toBe(false);
      expect(response.body.data.attributes.deviation).toBeCloseTo(-2, 1);
    });
  });
});
