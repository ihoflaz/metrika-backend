import { PrismaClient, ProjectStatus, Prisma } from '@prisma/client';
import { uuidv7 } from 'uuidv7';
import { badRequestError, notFoundError } from '../../common/errors';

export interface CreateProjectInput {
  name: string;
  description?: string;
  sponsorId: string;
  pmoOwnerId?: string;
  startDate: Date;
  endDate?: Date;
  budgetPlanned?: number;
  metadata?: Record<string, unknown>;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  status?: ProjectStatus;
  startDate?: Date;
  endDate?: Date | null;
  actualStart?: Date | null;
  actualEnd?: Date | null;
  budgetPlanned?: number | null;
  metadata?: Record<string, unknown> | null;
  pmoOwnerId?: string | null;
}

const toJsonValue = (value: Record<string, unknown> | null | undefined) => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return Prisma.JsonNull;
  }

  return value as Prisma.InputJsonValue;
};

const toDecimal = (value: number | null | undefined) => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  return new Prisma.Decimal(value);
};

const formatProjectCode = async (prisma: PrismaClient, at: Date) => {
  const year = at.getUTCFullYear();
  const prefix = `PRJ-${year}-`;

  const latest = await prisma.project.findFirst({
    where: { code: { startsWith: prefix } },
    orderBy: { code: 'desc' },
    select: { code: true },
  });

  const latestSequence = latest ? parseInt(latest.code.split('-')[2] ?? '0', 10) : 0;
  const nextSeq = Number.isNaN(latestSequence) ? 1 : latestSequence + 1;
  const sequence = nextSeq.toString().padStart(3, '0');
  return `${prefix}${sequence}`;
};

export class ProjectService {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async createProject(input: CreateProjectInput) {
    const existingSponsor = await this.prisma.user.findUnique({
      where: { id: input.sponsorId },
      select: { id: true },
    });

    if (!existingSponsor) {
      throw badRequestError(
        'PROJECT_INVALID_SPONSOR',
        'Sponsor not found',
        'Sponsor user must exist before project creation',
      );
    }

    const code = await formatProjectCode(this.prisma, new Date());
    const budgetPlanned = toDecimal(input.budgetPlanned);

    return this.prisma.project.create({
      data: {
        id: uuidv7(),
        code,
        name: input.name,
        description: input.description,
        sponsorId: input.sponsorId,
        pmoOwnerId: input.pmoOwnerId ?? null,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        budgetPlanned,
        metadata: toJsonValue(input.metadata),
      },
    });
  }

  async listProjects() {
    return this.prisma.project.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async getProjectById(id: string) {
    const project = await this.prisma.project.findUnique({ where: { id } });

    if (!project) {
      throw notFoundError('PROJECT_NOT_FOUND', 'Project not found');
    }

    return project;
  }

  async updateProject(id: string, input: UpdateProjectInput) {
    await this.ensureProjectExists(id);

    const budgetPlanned = toDecimal(input.budgetPlanned);

    return this.prisma.project.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        status: input.status,
        startDate: input.startDate,
        endDate: input.endDate ?? undefined,
        actualStart: input.actualStart ?? undefined,
        actualEnd: input.actualEnd ?? undefined,
        budgetPlanned,
        metadata: toJsonValue(input.metadata ?? undefined),
        pmoOwnerId: input.pmoOwnerId ?? undefined,
      },
    });
  }

  async closeProject(id: string) {
    await this.ensureProjectExists(id);

    return this.prisma.project.update({
      where: { id },
      data: {
        status: ProjectStatus.CLOSED,
        actualEnd: new Date(),
      },
    });
  }

  private async ensureProjectExists(id: string) {
    const exists = await this.prisma.project.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!exists) {
      throw notFoundError('PROJECT_NOT_FOUND', 'Project not found');
    }
  }
}
