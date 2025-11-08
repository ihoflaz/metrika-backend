import { writeFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import { PrismaClient, ProjectMemberRole, TaskDependencyType, DocumentApprovalDecision } from '@prisma/client';
import { FormData } from 'undici';
import { Blob } from 'buffer';
import { initializeEnv } from '../src/config/env';
import { loadAppConfig } from '../src/config/app-config';
import { seedCoreRbac } from '../src/modules/rbac/seed';

initializeEnv();

const prisma = new PrismaClient();
const config = loadAppConfig();

const BASE_URL = process.env.SEED_BASE_URL ?? 'http://localhost:3000';
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@metrika.local';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMeNow123!';
const SUMMARY_PATH = 'docs/SEED_DATA.md';

type JsonValue = Record<string, unknown>;

interface CreatedUser {
  id: string;
  fullName: string;
  email: string;
  password: string;
  roles: string[];
}

interface CreatedProject {
  id: string;
  name: string;
  code: string;
  members: Array<{ role: string; user: string }>;
}

interface CreatedTask {
  id: string;
  title: string;
  projectName: string;
}

interface CreatedDocument {
  id: string;
  title: string;
  projectName: string;
}

interface CreatedKpi {
  id: string;
  code: string;
  name: string;
  status: string;
}

interface CreatedSetting {
  key: string;
  value: unknown;
}

interface CreatedPreference {
  owner: string;
  keys: string[];
}

interface CreatedApiKey {
  owner: string;
  name: string;
  scopes: string[];
  key: string;
}

interface CreatedUnsubscribeToken {
  email: string;
  token: string;
  notificationType?: string;
  used: boolean;
}

const summary: {
  users: CreatedUser[];
  projects: CreatedProject[];
  tasks: CreatedTask[];
  documents: CreatedDocument[];
  kpis: CreatedKpi[];
  settings: CreatedSetting[];
  preferences: CreatedPreference[];
  apiKeys: CreatedApiKey[];
  unsubscribeTokens: CreatedUnsubscribeToken[];
} = {
  users: [],
  projects: [],
  tasks: [],
  documents: [],
  kpis: [],
  settings: [],
  preferences: [],
  apiKeys: [],
  unsubscribeTokens: [],
};

const sessionTokens = new Map<string, string>();

type RequestOptions = {
  method?: string;
  token?: string;
  json?: JsonValue | JsonValue[] | unknown;
  formData?: FormData;
  expectBody?: boolean;
};

async function http<T = any>(path: string, options: RequestOptions = {}) {
  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  if (options.formData) {
    body = options.formData as BodyInit;
  } else if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.json);
  }

  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers,
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Request failed (${response.status} ${response.statusText}) ${options.method ?? 'GET'} ${path}: ${errorText}`,
    );
  }

  if (response.status === 204 || options.expectBody === false) {
    return undefined as T;
  }

  const text = await response.text();
  if (!text) {
    return undefined as T;
  }

  return JSON.parse(text) as T;
}

async function ensureServerUp() {
  await http('/healthz', { expectBody: false });
}

async function login(email: string, password: string) {
  const result = await http<{ data: { attributes: { accessToken: string; refreshToken: string } } }>(
    '/api/v1/auth/login',
    {
      method: 'POST',
      json: { email, password },
    },
  );

  return result.data.attributes;
}

async function getUserToken(user: CreatedUser) {
  if (sessionTokens.has(user.email)) {
    return sessionTokens.get(user.email)!;
  }
  const tokens = await login(user.email, user.password);
  sessionTokens.set(user.email, tokens.accessToken);
  return tokens.accessToken;
}

async function resetDatabase() {
  await prisma.$executeRawUnsafe(`
    DO $$
    DECLARE
      stmt text;
    BEGIN
      SELECT 'TRUNCATE TABLE ' || string_agg(format('%I.%I', schemaname, tablename), ', ') || ' RESTART IDENTITY CASCADE'
      INTO stmt
      FROM pg_tables
      WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations';

      IF stmt IS NOT NULL THEN
        EXECUTE stmt;
      END IF;
    END $$;
  `);
}

function pickUsers(users: CreatedUser[], role: string, count = 1) {
  const filtered = users.filter((user) => user.roles.includes(role));
  if (filtered.length < count) {
    throw new Error(`Not enough users for role ${role}`);
  }
  return filtered.slice(0, count);
}

async function createUsers(adminToken: string) {
  const userSeeds = [
    { fullName: 'Selin Kaya', email: 'selin.kaya@demo.metrika.local', roles: ['PMO'] },
    { fullName: 'Mert Yildiz', email: 'mert.yildiz@demo.metrika.local', roles: ['PMO'] },
    { fullName: 'Can Demir', email: 'can.demir@demo.metrika.local', roles: ['PROJECT_MANAGER'] },
    { fullName: 'Elif Acar', email: 'elif.acar@demo.metrika.local', roles: ['PROJECT_MANAGER'] },
    { fullName: 'Ahmet Polat', email: 'ahmet.polat@demo.metrika.local', roles: ['PROJECT_MANAGER'] },
    { fullName: 'Derya Uzun', email: 'derya.uzun@demo.metrika.local', roles: ['TEAM_MEMBER'] },
    { fullName: 'Kaan Soylu', email: 'kaan.soylu@demo.metrika.local', roles: ['TEAM_MEMBER'] },
    { fullName: 'Leyla Erden', email: 'leyla.erden@demo.metrika.local', roles: ['TEAM_MEMBER'] },
    { fullName: 'Burak Ã‡imen', email: 'burak.cimen@demo.metrika.local', roles: ['TEAM_MEMBER'] },
    { fullName: 'Ebru Arda', email: 'ebru.arda@demo.metrika.local', roles: ['TEAM_MEMBER'] },
    { fullName: 'Gizem Sezer', email: 'gizem.sezer@demo.metrika.local', roles: ['TEAM_MEMBER'] },
    { fullName: 'Ozan KÃ¶se', email: 'ozan.kose@demo.metrika.local', roles: ['TEAM_MEMBER'] },
  ];

  const created: CreatedUser[] = [];

  for (let index = 0; index < userSeeds.length; index += 1) {
    const seed = userSeeds[index];
    const password = `DemoPass${index + 1}!Aa`;
    const response = await http<{ data: { id: string } }>('/api/v1/users', {
      method: 'POST',
      token: adminToken,
      json: {
        email: seed.email,
        fullName: seed.fullName,
        password,
        roles: seed.roles,
      },
    });

    const user: CreatedUser = {
      id: response.data.id,
      email: seed.email,
      fullName: seed.fullName,
      password,
      roles: seed.roles,
    };
    created.push(user);
    summary.users.push(user);
  }

  return created;
}

async function addProjectMembers(projectId: string, token: string, members: Array<{ userId: string; role: ProjectMemberRole; allocationPct?: number }>) {
  const details: Array<{ role: string; user: string }> = [];
  for (const member of members) {
    await http(`/api/v1/projects/${projectId}/members`, {
      method: 'POST',
      token,
      json: member,
    });
    details.push({ role: member.role, user: member.userId });
  }
  return details;
}

async function createProjects(adminToken: string, users: CreatedUser[]) {
  const [sponsor, secondarySponsor] = pickUsers(users, 'PMO', 2);
  const managers = pickUsers(users, 'PROJECT_MANAGER', 3);
  const teamMembers = users.filter((user) => user.roles.includes('TEAM_MEMBER'));

  const projectBlueprints = [
    {
      name: 'Metaverse Analytics Platform',
      description: 'Koordineli ziyaretÃ§i davranÄ±ÅŸÄ± analizi iÃ§in altyapÄ±',
      sponsorId: sponsor.id,
      pmoOwnerId: secondarySponsor.id,
      startDate: '2025-01-06',
      endDate: '2025-07-15',
    },
    {
      name: 'Supply Chain Visibility',
      description: 'GerÃ§ek zamanlÄ± stok takibi iÃ§in IoT entegrasyonu',
      sponsorId: secondarySponsor.id,
      pmoOwnerId: sponsor.id,
      startDate: '2025-02-03',
      endDate: '2025-10-30',
    },
    {
      name: 'Siber GÃ¼venlik Modernizasyonu',
      description: 'SOC otomasyonu ve olay mÃ¼dahale iyileÅŸtirmeleri',
      sponsorId: sponsor.id,
      pmoOwnerId: managers[2].id,
      startDate: '2025-03-17',
      endDate: '2025-12-20',
    },
  ];

  const projects: CreatedProject[] = [];

  for (const [index, blueprint] of projectBlueprints.entries()) {
    const response = await http<{ data: { id: string; attributes: { code: string } } }>('/api/v1/projects', {
      method: 'POST',
      token: adminToken,
      json: {
        name: blueprint.name,
        description: blueprint.description,
        sponsorId: blueprint.sponsorId,
        pmoOwnerId: blueprint.pmoOwnerId,
        startDate: blueprint.startDate,
        endDate: blueprint.endDate,
      },
    });

    const rotation = (offset: number) => teamMembers[(index * 3 + offset) % teamMembers.length];
    const roster = [
      { role: ProjectMemberRole.PM, user: managers[index % managers.length] },
      { role: ProjectMemberRole.LEAD, user: rotation(0) },
      { role: ProjectMemberRole.CONTRIBUTOR, user: rotation(1) },
      { role: ProjectMemberRole.REVIEWER, user: rotation(2) },
    ];

    const memberDetails = await addProjectMembers(
      response.data.id,
      adminToken,
      roster.map((entry) => ({
        userId: entry.user.id,
        role: entry.role,
        allocationPct: entry.role === ProjectMemberRole.PM ? 100 : 80,
      })),
    );

    const entry: CreatedProject = {
      id: response.data.id,
      name: blueprint.name,
      code: response.data.attributes.code,
      members: memberDetails.map((item) => ({
        role: item.role,
        user: roster.find((m) => m.user.id === item.user)?.user.fullName ?? item.user,
      })),
    };

    summary.projects.push(entry);
    projects.push(entry);
  }

  return { projects, managers, teamMembers, pmos: [sponsor, secondarySponsor] };
}

async function createTask(
  adminToken: string,
  projectId: string,
  payload: {
    title: string;
    description: string;
    ownerId: string;
    reporterId: string;
    plannedStart: string;
    plannedEnd: string;
    status: string;
    priority: string;
  },
) {
  const response = await http<{ data: { id: string } }>(`/api/v1/projects/${projectId}/tasks`, {
    method: 'POST',
    token: adminToken,
    json: payload,
  });

  return response.data.id;
}

async function addDependency(adminToken: string, taskId: string, dependsOnTaskId: string) {
  await http(`/api/v1/tasks/${taskId}/dependencies`, {
    method: 'POST',
    token: adminToken,
    json: {
      dependsOnTaskId,
      type: TaskDependencyType.FS,
    },
  });
}

async function addWatcher(adminToken: string, taskId: string, userId: string) {
  await http(`/api/v1/tasks/${taskId}/watchers`, {
    method: 'POST',
    token: adminToken,
    json: { userId },
  });
}

async function addComment(taskId: string, body: string, user: CreatedUser) {
  const token = await getUserToken(user);
  await http(`/api/v1/tasks/${taskId}/comments`, {
    method: 'POST',
    token,
    json: { body },
  });
}

async function createTasks(adminToken: string, dataset: { projects: CreatedProject[]; managers: CreatedUser[]; teamMembers: CreatedUser[] }) {
  const { projects, managers, teamMembers } = dataset;
  const taskDefinitions = [
    {
      title: 'Discovery Workshops',
      description: 'Ä°ÅŸ gereksinimlerinin toplanmasÄ±',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      plannedOffset: 0,
      durationDays: 10,
    },
    {
      title: 'Integration API Design',
      description: 'Harici servisler iÃ§in API tasarÄ±mÄ±',
      status: 'PLANNED',
      priority: 'HIGH',
      plannedOffset: 10,
      durationDays: 15,
    },
    {
      title: 'UAT Sprint',
      description: 'Son kullanÄ±cÄ± kabul testleri',
      status: 'PLANNED',
      priority: 'NORMAL',
      plannedOffset: 25,
      durationDays: 12,
    },
  ];

  const createdTasks: CreatedTask[] = [];

  for (const [index, project] of projects.entries()) {
    const manager = managers[index % managers.length];
    const assignees = teamMembers.slice(index, index + 3);
    const reporter = manager;
    const baseDate = new Date('2025-01-01');
    baseDate.setMonth(baseDate.getMonth() + index);

    const taskIds: string[] = [];

    for (const [taskIndex, definition] of taskDefinitions.entries()) {
      const owner = assignees[taskIndex % assignees.length];
      const startDate = new Date(baseDate);
      startDate.setDate(startDate.getDate() + definition.plannedOffset);
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + definition.durationDays);

      const taskId = await createTask(adminToken, project.id, {
        title: `${definition.title} (${project.code})`,
        description: definition.description,
        ownerId: owner.id,
        reporterId: reporter.id,
        plannedStart: startDate.toISOString(),
        plannedEnd: endDate.toISOString(),
        status: definition.status,
        priority: definition.priority,
      });

      taskIds.push(taskId);
      createdTasks.push({ id: taskId, title: `${definition.title} (${project.code})`, projectName: project.name });

      await addWatcher(adminToken, taskId, assignees[(taskIndex + 1) % assignees.length].id);
      await addWatcher(adminToken, taskId, assignees[(taskIndex + 2) % assignees.length].id);
      await addComment(
        taskId,
        `Not: ${definition.title} iÃ§in Ã¶ncelik ${definition.priority.toLowerCase()} olarak belirlendi.`,
        assignees[(taskIndex + 1) % assignees.length],
      );
    }

    if (taskIds.length >= 2) {
      await addDependency(adminToken, taskIds[1], taskIds[0]);
    }
  }

  summary.tasks.push(...createdTasks);
  return createdTasks;
}

async function createDocument(
  adminToken: string,
  projectId: string,
  payload: {
    title: string;
    docType: string;
    classification: string;
    ownerId: string;
    retentionPolicy: string;
    linkedTaskId?: string;
  },
) {
  const formData = new FormData();
  formData.set('title', payload.title);
  formData.set('docType', payload.docType);
  formData.set('classification', payload.classification);
  formData.set('ownerId', payload.ownerId);
  formData.set('retentionPolicy', payload.retentionPolicy);

  const fileBody = Buffer.from(
    `## ${payload.title}\n\nBu belge seed script tarafÄ±ndan ${new Date().toISOString()} tarihinde oluÅŸturulmuÅŸtur.`,
    'utf-8',
  );
  const blob = new Blob([fileBody], { type: 'application/pdf' });
  formData.append('file', blob, `${payload.title.replace(/\s+/g, '-').toLowerCase()}.pdf`);

  const response = await http<{ data: { id: string; attributes: { projectId: string }; relationships: any } }>(
    `/api/v1/projects/${projectId}/documents`,
    {
      method: 'POST',
      token: adminToken,
      formData,
    },
  );

  if (payload.linkedTaskId) {
    await http(`/api/v1/documents/${response.data.id}/link-task`, {
      method: 'POST',
      token: adminToken,
      json: { taskId: payload.linkedTaskId },
    });
  }

  return response.data.id;
}

async function addDocumentVersion(adminToken: string, documentId: string, note: string) {
  const formData = new FormData();
  formData.set('versionLabel', '2.0.0');
  const blob = new Blob(
    [
      Buffer.from(
        `## Version Update\n\n${note}\n\nGÃ¼ncelleme: ${new Date().toISOString()}`,
        'utf-8',
      ),
    ],
    { type: 'application/pdf' },
  );
  formData.append('file', blob, `update-${documentId}.pdf`);

  const response = await http<{ data: { id: string } }>(`/api/v1/documents/${documentId}/versions`, {
    method: 'POST',
    token: adminToken,
    formData,
  });

  return response.data.id;
}

async function approveDocumentVersion(documentId: string, versionId: string, user: CreatedUser) {
  const token = await getUserToken(user);
  await http(`/api/v1/documents/${documentId}/versions/${versionId}/approve`, {
    method: 'POST',
    token,
    json: {
      decision: DocumentApprovalDecision.APPROVED,
      comment: 'Seed veri seti onayÄ±',
    },
  });
}

async function createDocuments(adminToken: string, projects: CreatedProject[], tasks: CreatedTask[], owners: CreatedUser[], approvers: CreatedUser[]) {
  const createdDocs: CreatedDocument[] = [];

  for (const [index, project] of projects.entries()) {
    const owner = owners[index % owners.length];
    const taskForLink = tasks.find((t) => t.projectName === project.name);
    const documentId = await createDocument(adminToken, project.id, {
      title: `Proje Kickoff NotlarÄ± - ${project.code}`,
      docType: 'REPORT',
      classification: 'INTERNAL',
      ownerId: owner.id,
      retentionPolicy: 'DEFAULT',
      linkedTaskId: taskForLink?.id,
    });

    const versionId = await addDocumentVersion(
      adminToken,
      documentId,
      `${project.name} iÃ§in gÃ¼ncellenmiÅŸ kapsam onayÄ±.`,
    );

    await approveDocumentVersion(documentId, versionId, owner);
    await approveDocumentVersion(documentId, versionId, approvers[index % approvers.length]);

    createdDocs.push({ id: documentId, title: `Proje Kickoff NotlarÄ± - ${project.code}`, projectName: project.name });
  }

  summary.documents.push(...createdDocs);
  return createdDocs;
}

async function createKpis(adminToken: string, projects: CreatedProject[], stewards: CreatedUser[]) {
  const kpiSeeds = [
    {
      code: 'SCH-OTD',
      name: 'ZamanÄ±nda Teslimat',
      category: 'SCHEDULE',
      targetValue: 95,
      unit: '%',
    },
    {
      code: 'QUAL-MTTR',
      name: 'Olay Ã‡Ã¶zÃ¼m SÃ¼resi',
      category: 'QUALITY',
      targetValue: 6,
      unit: 'saat',
    },
  ];

  const kpis: CreatedKpi[] = [];

  for (const [index, seed] of kpiSeeds.entries()) {
    const project = projects[index % projects.length];
    const steward = stewards[index % stewards.length];
    const response = await http<{ data: { id: string } }>('/api/v1/kpis', {
      method: 'POST',
      token: adminToken,
      json: {
        code: seed.code,
        name: seed.name,
        category: seed.category,
        calculationFormula: 'actual/target',
        targetValue: seed.targetValue,
        unit: seed.unit,
        thresholdWarning: seed.targetValue * 0.9,
        thresholdCritical: seed.targetValue * 0.8,
        aggregationPeriod: 'MONTHLY',
        dataSourceType: 'MANUAL',
        stewardId: steward.id,
        linkedProjectIds: [project.id],
      },
    });

    await http(`/api/v1/kpis/${response.data.id}/values`, {
      method: 'POST',
      token: adminToken,
      json: {
        periodStart: '2025-01-01T00:00:00.000Z',
        periodEnd: '2025-01-31T00:00:00.000Z',
        actualValue: seed.targetValue * 0.92,
        valueSource: 'MANUAL_ENTRY',
      },
    });

    await http(`/api/v1/kpis/${response.data.id}/values`, {
      method: 'POST',
      token: adminToken,
      json: {
        periodStart: '2025-02-01T00:00:00.000Z',
        periodEnd: '2025-02-28T00:00:00.000Z',
        actualValue: seed.targetValue * (index === 0 ? 0.97 : 0.75),
        valueSource: 'MANUAL_ENTRY',
      },
    });

    if (index === 1) {
      await http(`/api/v1/kpis/${response.data.id}`, {
        method: 'PATCH',
        token: adminToken,
        json: {
          status: 'BREACHED',
        },
      });
    }

    kpis.push({
      id: response.data.id,
      code: seed.code,
      name: seed.name,
      status: index === 1 ? 'BREACHED' : 'MONITORING',
    });
  }

  summary.kpis.push(...kpis);
  return kpis;
}

async function createSystemSettings(adminToken: string) {
  const settings = [
    {
      key: 'reports.defaultTimeframe',
      value: 'Q3-2025',
      dataType: 'string',
      description: 'Rapor ekranlarÄ±ndaki varsayÄ±lan zaman aralÄ±ÄŸÄ±',
      isPublic: true,
      category: 'reports',
    },
    {
      key: 'automation.reminderWindowDays',
      value: 5,
      dataType: 'number',
      description: 'Gecikme hatÄ±rlatmasÄ± Ã¶ncesi gÃ¼n sayÄ±sÄ±',
      isPublic: false,
      category: 'automation',
    },
  ];

  for (const setting of settings) {
    await http('/api/v1/settings', {
      method: 'POST',
      token: adminToken,
      json: setting,
    });
    summary.settings.push({ key: setting.key, value: setting.value });
  }
}

async function createPreferences(user: CreatedUser) {
  const token = await getUserToken(user);
  await http('/api/v1/user/preferences/bulk', {
    method: 'POST',
    token,
    json: {
      preferences: {
        'ui.sidebarPinned': true,
        'notifications.digest': 'weekly',
        'tasks.defaultView': 'kanban',
      },
    },
  });

  summary.preferences.push({
    owner: user.fullName,
    keys: ['ui.sidebarPinned', 'notifications.digest', 'tasks.defaultView'],
  });
}

async function createApiKey(user: CreatedUser) {
  const token = await getUserToken(user);
  const response = await http<{ apiKey: { id: string; key: string; scopes: string[]; name: string } }>(
    '/api/v1/users/api-keys',
    {
      method: 'POST',
      token,
      json: {
        name: 'integration-key',
        scopes: ['project:read', 'task:write'],
        expiresInDays: 120,
      },
    },
  );

  summary.apiKeys.push({
    owner: user.fullName,
    name: response.apiKey.name,
    scopes: response.apiKey.scopes,
    key: response.apiKey.key,
  });
}

async function createUnsubscribeTokens(users: CreatedUser[]) {
  const targets = users.slice(0, 2);
  for (const [index, user] of targets.entries()) {
    const tokenRecord = await prisma.unsubscribeToken.create({
      data: {
        token: randomUUID().replace(/-/g, ''),
        userId: user.id,
        email: user.email,
        notificationType: index === 0 ? 'weekly-digest' : 'task-alerts',
      },
    });

    const entry: CreatedUnsubscribeToken = {
      email: user.email,
      token: tokenRecord.token,
      notificationType: tokenRecord.notificationType ?? undefined,
      used: false,
    };

    if (index === 0) {
      await http(`/api/v1/unsubscribe/${tokenRecord.token}`, { method: 'GET', expectBody: false });
      entry.used = true;
    }

    summary.unsubscribeTokens.push(entry);
  }
}


async function writeSummary() {
  const lines: string[] = [];
  lines.push('# Demo Seed Verisi');
  lines.push('');
  lines.push(`Olusturma zamani: ${new Date().toISOString()}`);
  lines.push('');

  lines.push(`## Kullanicilar (${summary.users.length})`);
  lines.push('| Ad | E-posta | Roller | Gecici Sifre |');
  lines.push('| --- | --- | --- | --- |');
  summary.users.forEach((user) => {
    lines.push(`| ${user.fullName} | ${user.email} | ${user.roles.join(', ')} | ${user.password} |`);
  });
  lines.push('');

  lines.push(`## Projeler (${summary.projects.length})`);
  summary.projects.forEach((project) => {
    lines.push(`- **${project.name}** (${project.code})`);
    lines.push('  - Uyeler:');
    project.members.forEach((member) => {
      lines.push(`    - ${member.role}: ${member.user}`);
    });
  });
  lines.push('');

  lines.push(`## Gorevler (${summary.tasks.length})`);
  summary.tasks.forEach((task) => {
    lines.push(`- ${task.title} (${task.projectName})`);
  });
  lines.push('');

  lines.push(`## Dokumanlar (${summary.documents.length})`);
  summary.documents.forEach((doc) => {
    lines.push(`- ${doc.title} (${doc.projectName})`);
  });
  lines.push('');

  lines.push(`## KPI'lar (${summary.kpis.length})`);
  summary.kpis.forEach((kpi) => {
    lines.push(`- ${kpi.code} - ${kpi.name} [${kpi.status}]`);
  });
  lines.push('');

  lines.push('## Sistem Ayarlari');
  summary.settings.forEach((setting) => {
    lines.push(`- ${setting.key}: ${JSON.stringify(setting.value)}`);
  });
  lines.push('');

  lines.push('## Kullanici Tercihleri');
  summary.preferences.forEach((pref) => {
    lines.push(`- ${pref.owner}: ${pref.keys.join(', ')}`);
  });
  lines.push('');

  lines.push('## API Anahtarlari');
  summary.apiKeys.forEach((key) => {
    lines.push(`- ${key.owner}: ${key.name} (${key.scopes.join(', ')}) -> ${key.key}`);
  });
  lines.push('');

  lines.push('## Unsubscribe Tokenlari');
  summary.unsubscribeTokens.forEach((token) => {
    lines.push(
      `- ${token.email}: ${token.notificationType ?? 'genel'} (kullanildi mi: ${token.used ? 'evet' : 'hayir'})`,
    );
  });

  await writeFile(SUMMARY_PATH, `${lines.join('\n')}\n`, 'utf-8');
}

async function run() {
  console.log('Resetting database...');
  await resetDatabase();
  console.log('Seeding RBAC + admin...');
  await seedCoreRbac(prisma, config.PASSWORD_MIN_LENGTH, {
    adminEmail: ADMIN_EMAIL,
    adminPassword: ADMIN_PASSWORD,
    adminFullName: 'Platform Administrator',
  });

  console.log('Checking API health...');
  await ensureServerUp();

  console.log('Logging in as admin...');
  const adminTokens = await login(ADMIN_EMAIL, ADMIN_PASSWORD);

  console.log('Creating demo users...');
  const users = await createUsers(adminTokens.accessToken);

  console.log('Creating projects and members...');
  const projectDataset = await createProjects(adminTokens.accessToken, users);

  console.log('Creating tasks, dependencies, watchers & comments...');
  const createdTasks = await createTasks(adminTokens.accessToken, projectDataset);

  console.log('Creating documents, versions and approvals...');
  await createDocuments(adminTokens.accessToken, projectDataset.projects, createdTasks, projectDataset.managers, projectDataset.pmos);

  console.log('Creating KPI definitions and data points...');
  await createKpis(adminTokens.accessToken, projectDataset.projects, projectDataset.managers);

  console.log('Creating system settings...');
  await createSystemSettings(adminTokens.accessToken);

  console.log('Setting user preferences...');
  await createPreferences(users.find((user) => user.email === 'leyla.erden@demo.metrika.local')!);

  console.log('Creating API key for Can Demir...');
  const canUser = users.find((user) => user.email === 'can.demir@demo.metrika.local');
  if (canUser) {
    await createApiKey(canUser);
  }

  console.log('Generating unsubscribe tokens...');
  await createUnsubscribeTokens(users);

  console.log('Writing summary document...');
  await writeSummary();

  console.log('Seed iÅŸlemi tamamlandÄ±.');
}

run()
  .catch((error) => {
    console.error('Seed iÅŸlemi baÅŸarÄ±sÄ±z:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

