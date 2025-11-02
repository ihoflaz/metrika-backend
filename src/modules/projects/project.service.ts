import { PrismaClient, ProjectStatus, TaskStatus, Prisma } from '@prisma/client';
import { uuidv7 } from 'uuidv7';
import { badRequestError, notFoundError } from '../../common/errors';
import { ProjectCodeService } from './project-code.service';
import {
  parsePagination,
  calculateSkip,
  createPaginatedResponse,
  parseDateRange,
  parseMultipleValues,
  parseSearchQuery,
  validateSortField,
  parseSortOrder,
  buildOrderBy,
  type PaginationResult,
} from '../../common/query-builder';

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

export interface ListProjectsFilters {
  status?: string | string[];
  sponsorId?: string;
  pmoOwnerId?: string;
  search?: string;
  startDateFrom?: string;
  startDateTo?: string;
  endDateFrom?: string;
  endDateTo?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
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

// DEPRECATED: Old project code generation (race condition prone)
// Kept for reference only - use ProjectCodeService instead
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
  private readonly projectCodeService: ProjectCodeService;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.projectCodeService = new ProjectCodeService(prisma);
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

    // Generate unique project code using new service (thread-safe)
    const code = await this.projectCodeService.generateCode();
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

  async listProjects(filters: ListProjectsFilters = {}): Promise<PaginationResult<any>> {
    // Pagination
    const { page, limit } = parsePagination({ page: filters.page, limit: filters.limit });
    const skip = calculateSkip(page, limit);

    // Sorting
    const allowedSortFields = ['createdAt', 'name', 'startDate', 'endDate', 'status'];
    const sortBy = validateSortField(filters.sortBy, allowedSortFields);
    const sortOrder = parseSortOrder(filters.sortOrder);
    const orderBy = buildOrderBy(sortBy, sortOrder);

    // Build where clause
    const where: Prisma.ProjectWhereInput = {};

    // Status filter (multiple values)
    const statuses = parseMultipleValues(filters.status);
    if (statuses && statuses.length > 0) {
      where.status = { in: statuses as ProjectStatus[] };
    }

    // Sponsor filter
    if (filters.sponsorId) {
      where.sponsorId = filters.sponsorId;
    }

    // PMO Owner filter
    if (filters.pmoOwnerId) {
      where.pmoOwnerId = filters.pmoOwnerId;
    }

    // Search filter (name or description)
    const searchQuery = parseSearchQuery(filters.search);
    if (searchQuery) {
      where.OR = [
        { name: searchQuery },
        { description: searchQuery },
        { code: searchQuery },
      ];
    }

    // Start date range
    const startDateRange = parseDateRange(filters.startDateFrom, filters.startDateTo);
    if (startDateRange) {
      where.startDate = startDateRange;
    }

    // End date range
    const endDateRange = parseDateRange(filters.endDateFrom, filters.endDateTo);
    if (endDateRange) {
      where.endDate = endDateRange;
    }

    // Execute queries
    const [projects, total] = await Promise.all([
      this.prisma.project.findMany({
        where,
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.project.count({ where }),
    ]);

    return createPaginatedResponse(projects, total, page, limit);
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

    // Validate: All tasks must be COMPLETED or CANCELLED
    const incompleteTasks = await this.prisma.task.findMany({
      where: {
        projectId: id,
        status: {
          notIn: [TaskStatus.COMPLETED, TaskStatus.CANCELLED],
        },
      },
      select: {
        id: true,
        title: true,
        status: true,
      },
    });

    if (incompleteTasks.length > 0) {
      throw badRequestError(
        'PROJECT_HAS_INCOMPLETE_TASKS',
        'Cannot close project with incomplete tasks',
        `Project has ${incompleteTasks.length} incomplete task(s). All tasks must be COMPLETED or CANCELLED before closing the project.`,
      );
    }

    // Close the project
    return this.prisma.project.update({
      where: { id },
      data: {
        status: ProjectStatus.CLOSED,
        actualEnd: new Date(),
      },
    });
  }

  /**
   * Get project closure statistics for PDF report
   */
  async getProjectClosureStats(id: string) {
    const project = await this.getProjectById(id);

    // Get task statistics
    const [
      totalTasks,
      completedTasks,
      cancelledTasks,
      totalDocuments,
      members,
    ] = await Promise.all([
      this.prisma.task.count({ where: { projectId: id } }),
      this.prisma.task.count({ 
        where: { projectId: id, status: TaskStatus.COMPLETED } 
      }),
      this.prisma.task.count({ 
        where: { projectId: id, status: TaskStatus.CANCELLED } 
      }),
      this.prisma.document.count({ where: { projectId: id } }),
      this.prisma.projectMember.count({ where: { projectId: id } }),
    ]);

    // Calculate project duration
    const startDate = project.startDate;
    const endDate = project.actualEnd || new Date();
    const durationDays = Math.ceil(
      (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    return {
      project: {
        id: project.id,
        code: project.code,
        name: project.name,
        description: project.description,
        status: project.status,
        startDate: project.startDate,
        endDate: project.endDate,
        actualStart: project.actualStart,
        actualEnd: project.actualEnd,
        budgetPlanned: project.budgetPlanned,
        durationDays,
      },
      statistics: {
        totalTasks,
        completedTasks,
        cancelledTasks,
        completionRate: totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0,
        totalDocuments,
        totalMembers: members,
      },
    };
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
