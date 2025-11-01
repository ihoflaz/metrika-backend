import { PrismaClient, UserStatus, DocumentVersionStatus } from '@prisma/client';
import { uuidv7 } from 'uuidv7';
import { setupTestApp, teardownTestApp, type TestAppContext } from '../utils/test-app';
import { hashPassword } from '../../src/modules/auth/password.service';
import { ROLES } from '../../src/modules/rbac/permissions';

const SAMPLE_CONTENT = 'Merhaba Metrika!';
const UPDATED_CONTENT = 'Yeni versiyon icerigi';
const EICAR_STRING = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

type DocumentVersionResponse = {
  id: string;
  attributes: { status: DocumentVersionStatus };
};

const createRoleUser = async (
  prisma: PrismaClient,
  roleCode: string,
  overrides: Partial<{ email: string; fullName: string; password: string }> = {},
) => {
  const password = overrides.password ?? 'SecurePass123!';
  const passwordHash = await hashPassword(password);
  const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
  const userId = uuidv7();

  await prisma.user.create({
    data: {
      id: userId,
      email: overrides.email ?? `${roleCode.toLowerCase()}-doc@metrika.local`,
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
    email: overrides.email ?? `${roleCode.toLowerCase()}-doc@metrika.local`,
    password,
  };
};

const login = async (context: TestAppContext, credentials: { email: string; password: string }) => {
  const response = await context.httpClient.post('/api/v1/auth/login').send(credentials);
  expect(response.status).toBe(200);
  return response.body.data.attributes.accessToken as string;
};

describe('Document API', () => {
  let context: TestAppContext;
  let prisma: PrismaClient;
  let pmoToken: string;
  let pmToken: string;
  let sponsorId: string;
  let projectId: string;
  let documentId: string;

  beforeAll(async () => {
    context = await setupTestApp();
    prisma = context.prisma;

    const pmoUser = await createRoleUser(prisma, ROLES.PMO, {
      email: 'pmo-doc@metrika.local',
      fullName: 'PMO Document',
    });

    const pmUser = await createRoleUser(prisma, ROLES.PROJECT_MANAGER, {
      email: 'pm-doc@metrika.local',
      fullName: 'Project Manager Doc',
    });

    const sponsor = await createRoleUser(prisma, ROLES.SYSADMIN, {
      email: 'sponsor-doc@metrika.local',
      fullName: 'Document Sponsor',
    });

    sponsorId = sponsor.id;

    pmoToken = await login(context, { email: pmoUser.email, password: pmoUser.password });
    pmToken = await login(context, { email: pmUser.email, password: pmUser.password });

    const projectResponse = await context.httpClient
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${pmoToken}`)
      .send({
        name: 'Dokuman Projesi',
        sponsorId,
        startDate: '2025-03-01',
      });

    expect(projectResponse.status).toBe(201);
    projectId = projectResponse.body.data.id as string;
  });

  afterAll(async () => {
    await teardownTestApp(context);
  });

  it('Dokuman yukler ve metadata/dosya download islemlerini gerceklestirir', async () => {
    const response = await context.httpClient
      .post(`/api/v1/projects/${projectId}/documents`)
      .set('Authorization', `Bearer ${pmToken}`)
      .field('title', 'Proje Baslangic Plani')
      .field('docType', 'PLAN')
      .field('classification', 'INTERNAL')
      .field('ownerId', sponsorId)
      .field('retentionPolicy', 'DEFAULT')
      .attach('file', Buffer.from(SAMPLE_CONTENT, 'utf8'), {
        filename: 'plan.txt',
        contentType: 'text/plain',
      });

    expect(response.status).toBe(201);
    documentId = response.body.data.id as string;
    expect(response.body.data.attributes.title).toBe('Proje Baslangic Plani');

    const metadataResponse = await context.httpClient
      .get(`/api/v1/documents/${documentId}`)
      .set('Authorization', `Bearer ${pmToken}`);

    expect(metadataResponse.status).toBe(200);
    expect(metadataResponse.body.data.attributes.docType).toBe('PLAN');
    expect(metadataResponse.body.data.relationships.versions.length).toBe(1);

    const firstVersionId = metadataResponse.body.data.relationships.versions[0].id as string;

    // Approve the first version with two different users
    await context.httpClient
      .post(`/api/v1/documents/${documentId}/versions/${firstVersionId}/approve`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({ decision: 'APPROVED' });

    await context.httpClient
      .post(`/api/v1/documents/${documentId}/versions/${firstVersionId}/approve`)
      .set('Authorization', `Bearer ${pmoToken}`)
      .send({ decision: 'APPROVED' });

    const downloadResponse = await context.httpClient
      .get(`/api/v1/documents/${documentId}/download`)
      .set('Authorization', `Bearer ${pmToken}`);

    expect(downloadResponse.status).toBe(200);
    expect(downloadResponse.headers['content-disposition']).toContain('attachment');
    expect(downloadResponse.text).toBe(SAMPLE_CONTENT);
  });

  it('Yeni versiyon yukleyip iki onayla yayinlar', async () => {
    const versionResponse = await context.httpClient
      .post(`/api/v1/documents/${documentId}/versions`)
      .set('Authorization', `Bearer ${pmToken}`)
      .attach('file', Buffer.from(UPDATED_CONTENT, 'utf8'), {
        filename: 'plan-v2.txt',
        contentType: 'text/plain',
      });

    expect(versionResponse.status).toBe(201);
    const newVersionId = versionResponse.body.data.id as string;

    const firstApproval = await context.httpClient
      .post(`/api/v1/documents/${documentId}/versions/${newVersionId}/approve`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({ decision: 'APPROVED' });

    expect(firstApproval.status).toBe(200);

    const secondApproval = await context.httpClient
      .post(`/api/v1/documents/${documentId}/versions/${newVersionId}/approve`)
      .set('Authorization', `Bearer ${pmoToken}`)
      .send({ decision: 'APPROVED' });

    expect(secondApproval.status).toBe(200);

    const metadataResponse = await context.httpClient
      .get(`/api/v1/documents/${documentId}`)
      .set('Authorization', `Bearer ${pmToken}`);

    expect(metadataResponse.status).toBe(200);
    expect(metadataResponse.body.data.attributes.currentVersionId).toBe(newVersionId);

    const publishedVersion = metadataResponse.body.data.relationships.versions.find(
      (version: DocumentVersionResponse) => version.id === newVersionId,
    );

    expect(publishedVersion.attributes.status).toBe(DocumentVersionStatus.PUBLISHED);
  });

  it('Virus taramasinda yakalanan dosyalari reddeder', async () => {
    const response = await context.httpClient
      .post(`/api/v1/projects/${projectId}/documents`)
      .set('Authorization', `Bearer ${pmToken}`)
      .field('title', 'EICAR Test Dosyasi')
      .field('docType', 'REPORT')
      .field('classification', 'INTERNAL')
      .field('ownerId', sponsorId)
      .field('retentionPolicy', 'DEFAULT')
      .attach('file', Buffer.from(EICAR_STRING, 'utf8'), {
        filename: 'eicar.txt',
        contentType: 'text/plain',
      });

    expect(response.status).toBe(400);
    expect(response.body.errors[0].code).toBe('DOCUMENT_VIRUS_DETECTED');
  });

  it('Dokumanlari listeler ve sayfalama ile filtreler', async () => {
    // Create more documents for pagination testing
    const doc1Response = await context.httpClient
      .post(`/api/v1/projects/${projectId}/documents`)
      .set('Authorization', `Bearer ${pmToken}`)
      .field('title', 'Risk Analizi')
      .field('docType', 'RISK')
      .field('classification', 'CONFIDENTIAL')
      .field('ownerId', sponsorId)
      .field('retentionPolicy', 'DEFAULT')
      .field('tags', 'risk,analysis')
      .attach('file', Buffer.from('Risk dokumani', 'utf8'), {
        filename: 'risk.txt',
        contentType: 'text/plain',
      });
    expect(doc1Response.status).toBe(201);

    const doc2Response = await context.httpClient
      .post(`/api/v1/projects/${projectId}/documents`)
      .set('Authorization', `Bearer ${pmToken}`)
      .field('title', 'Proje Sozlesmesi')
      .field('docType', 'CONTRACT')
      .field('classification', 'RESTRICTED')
      .field('ownerId', sponsorId)
      .field('retentionPolicy', 'LEGAL_HOLD')
      .field('tags', 'contract,legal')
      .attach('file', Buffer.from('Sozlesme icerigi', 'utf8'), {
        filename: 'contract.pdf',
        contentType: 'application/pdf',
      });
    expect(doc2Response.status).toBe(201);

    const doc3Response = await context.httpClient
      .post(`/api/v1/projects/${projectId}/documents`)
      .set('Authorization', `Bearer ${pmToken}`)
      .field('title', 'Test Baslangic Raporu')
      .field('docType', 'REPORT')
      .field('classification', 'PUBLIC')
      .field('ownerId', sponsorId)
      .field('retentionPolicy', 'DEFAULT')
      .field('tags', 'test,report')
      .attach('file', Buffer.from('Rapor icerigi', 'utf8'), {
        filename: 'report.txt',
        contentType: 'text/plain',
      });
    expect(doc3Response.status).toBe(201);

    // List all documents
    const listAllResponse = await context.httpClient
      .get('/api/v1/documents')
      .set('Authorization', `Bearer ${pmToken}`);

    expect(listAllResponse.status).toBe(200);
    expect(listAllResponse.body.data.length).toBeGreaterThanOrEqual(3);
    expect(listAllResponse.body.meta.pagination).toBeDefined();
    expect(listAllResponse.body.meta.pagination.page).toBe(1);
    expect(listAllResponse.body.meta.pagination.pageSize).toBe(20);

    // Filter by project
    const projectFilterResponse = await context.httpClient
      .get(`/api/v1/documents?projectId=${projectId}`)
      .set('Authorization', `Bearer ${pmToken}`);

    expect(projectFilterResponse.status).toBe(200);
    expect(projectFilterResponse.body.data.length).toBeGreaterThanOrEqual(3);

    // Filter by docType
    const typeFilterResponse = await context.httpClient
      .get('/api/v1/documents?docType=RISK')
      .set('Authorization', `Bearer ${pmToken}`);

    expect(typeFilterResponse.status).toBe(200);
    expect(typeFilterResponse.body.data.length).toBeGreaterThanOrEqual(1);
    expect(typeFilterResponse.body.data[0].attributes.docType).toBe('RISK');

    // Filter by classification
    const classFilterResponse = await context.httpClient
      .get('/api/v1/documents?classification=CONFIDENTIAL')
      .set('Authorization', `Bearer ${pmToken}`);

    expect(classFilterResponse.status).toBe(200);
    expect(classFilterResponse.body.data.length).toBeGreaterThanOrEqual(1);

    // Search by title
    const searchResponse = await context.httpClient
      .get('/api/v1/documents?search=Baslangic')
      .set('Authorization', `Bearer ${pmToken}`);

    expect(searchResponse.status).toBe(200);
    expect(searchResponse.body.data.length).toBeGreaterThanOrEqual(1);
    const titles = searchResponse.body.data.map((d: any) => d.attributes.title);
    expect(titles.some((t: string) => t.includes('Baslangic'))).toBe(true);

    // Filter by tags
    const tagsFilterResponse = await context.httpClient
      .get('/api/v1/documents?tags=risk,analysis')
      .set('Authorization', `Bearer ${pmToken}`);

    expect(tagsFilterResponse.status).toBe(200);
    expect(tagsFilterResponse.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('Farkli sayfa boyutlari ile pagination yapar', async () => {
    // Test page size 20
    const page20Response = await context.httpClient
      .get('/api/v1/documents?pageSize=20')
      .set('Authorization', `Bearer ${pmToken}`);

    expect(page20Response.status).toBe(200);
    expect(page20Response.body.meta.pagination.pageSize).toBe(20);

    // Test page size 50
    const page50Response = await context.httpClient
      .get('/api/v1/documents?pageSize=50')
      .set('Authorization', `Bearer ${pmToken}`);

    expect(page50Response.status).toBe(200);
    expect(page50Response.body.meta.pagination.pageSize).toBe(50);

    // Test page size 100
    const page100Response = await context.httpClient
      .get('/api/v1/documents?pageSize=100')
      .set('Authorization', `Bearer ${pmToken}`);

    expect(page100Response.status).toBe(200);
    expect(page100Response.body.meta.pagination.pageSize).toBe(100);

    // Test invalid page size
    const invalidPageSizeResponse = await context.httpClient
      .get('/api/v1/documents?pageSize=999')
      .set('Authorization', `Bearer ${pmToken}`);

    expect(invalidPageSizeResponse.status).toBe(422);
  });
});
