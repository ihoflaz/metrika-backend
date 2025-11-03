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

  /**
   * Full-text search projects with PostgreSQL ts_query
   * @param query Search query string
   * @param options Search options (limit, status filter)
   * @returns Array of projects with relevance ranking
   */
  async searchProjects(
    query: string,
    options?: { limit?: number; status?: ProjectStatus }
  ) {
    const limit = options?.limit || 20;

    // Convert search query to tsquery format
    const tsQuery = query
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0)
      .join(' & ');

    // Build SQL query with full-text search ranking
    let sql = `
      SELECT 
        p."id",
        p."code",
        p."name",
        p."description",
        p."status",
        p."startDate",
        p."endDate",
        p."actualStart",
        p."actualEnd",
        p."budgetPlanned",
        p."createdAt",
        p."updatedAt",
        ts_rank(p."searchVector", to_tsquery('english', $1)) as rank,
        jsonb_build_object(
          'id', s."id",
          'fullName', s."fullName",
          'email', s."email"
        ) as sponsor,
        jsonb_build_object(
          'id', pm."id",
          'fullName', pm."fullName",
          'email', pm."email"
        ) as pmo_owner
      FROM "Project" p
      INNER JOIN "User" s ON p."sponsorId" = s."id"
      LEFT JOIN "User" pm ON p."pmoOwnerId" = pm."id"
      WHERE p."searchVector" @@ to_tsquery('english', $1)
    `;

    const params: Array<string> = [tsQuery];

    if (options?.status) {
      sql += ` AND p."status" = $2`;
      params.push(options.status);
    }

    sql += ` ORDER BY rank DESC, p."updatedAt" DESC LIMIT ${limit}`;

    const results = await this.prisma.$queryRawUnsafe<
      Array<{
        id: string;
        code: string;
        name: string;
        description: string | null;
        status: ProjectStatus;
        startDate: Date;
        endDate: Date | null;
        actualStart: Date | null;
        actualEnd: Date | null;
        budgetPlanned: unknown | null; // Decimal type
        createdAt: Date;
        updatedAt: Date;
        rank: number;
        sponsor: { id: string; fullName: string; email: string };
        pmo_owner: { id: string; fullName: string; email: string } | null;
      }>
    >(sql, ...params);

    // Transform budgetPlanned from Decimal to number
    return results.map((p) => ({
      ...p,
      budgetPlanned: p.budgetPlanned ? Number(p.budgetPlanned) : null,
    }));
  }
}
