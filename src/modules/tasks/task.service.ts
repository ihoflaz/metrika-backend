import { PrismaClient, TaskStatus, TaskPriority, Prisma, TaskDependencyType } from '@prisma/client';
import { uuidv7 } from 'uuidv7';
import { badRequestError, notFoundError } from '../../common/errors';

export interface CreateTaskInput {
  projectId: string;
  parentTaskId?: string;
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  ownerId: string;
  reporterId?: string;
  plannedStart?: Date;
  plannedEnd?: Date;
  progressPct?: number;
  effortPlannedHours?: number | null;
  effortLoggedHours?: number | null;
  metadata?: Record<string, unknown>;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  ownerId?: string;
  reporterId?: string | null;
  plannedStart?: Date | null;
  plannedEnd?: Date | null;
  actualStart?: Date | null;
  actualEnd?: Date | null;
  progressPct?: number;
  effortPlannedHours?: number | null;
  effortLoggedHours?: number | null;
  metadata?: Record<string, unknown> | null;
}

export interface CreateDependencyInput {
  dependsOnTaskId: string;
  type?: TaskDependencyType;
  lagMinutes?: number | null;
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

const taskInclude = {
  owner: {
    select: {
      id: true,
      fullName: true,
      email: true,
    },
  },
  reporter: {
    select: {
      id: true,
      fullName: true,
      email: true,
    },
  },
  project: {
    select: {
      id: true,
      code: true,
      name: true,
    },
  },
} as const;

export class TaskService {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async createTask(input: CreateTaskInput) {
    await this.ensureProject(input.projectId);
    await this.ensureUser(input.ownerId);

    if (input.parentTaskId) {
      await this.ensureTask(input.parentTaskId);
    }

    if (input.reporterId) {
      await this.ensureUser(input.reporterId);
    }

    if (
      typeof input.progressPct === 'number' &&
      (input.progressPct < 0 || input.progressPct > 100)
    ) {
      throw badRequestError('TASK_INVALID_PROGRESS', 'Progress must be between 0 and 100');
    }

    const effortPlannedHours = toDecimal(input.effortPlannedHours);
    const effortLoggedHours = toDecimal(input.effortLoggedHours);

    return this.prisma.task.create({
      data: {
        id: uuidv7(),
        projectId: input.projectId,
        parentTaskId: input.parentTaskId ?? null,
        title: input.title,
        description: input.description,
        status: input.status ?? TaskStatus.PLANNED,
        priority: input.priority ?? TaskPriority.NORMAL,
        ownerId: input.ownerId,
        reporterId: input.reporterId ?? null,
        plannedStart: input.plannedStart ?? null,
        plannedEnd: input.plannedEnd ?? null,
        progressPct: input.progressPct ?? 0,
        effortPlannedHours,
        effortLoggedHours,
        metadata: toJsonValue(input.metadata),
      },
      include: taskInclude,
    });
  }

  async listProjectTasks(projectId: string) {
    await this.ensureProject(projectId);

    return this.prisma.task.findMany({
      where: { projectId },
      orderBy: [{ plannedStart: 'asc' }, { createdAt: 'asc' }],
      include: taskInclude,
    });
  }

  async getTaskById(id: string) {
    const task = await this.prisma.task.findUnique({
      where: { id },
      include: taskInclude,
    });

    if (!task) {
      throw notFoundError('TASK_NOT_FOUND', 'Task not found');
    }

    return task;
  }

  async updateTask(id: string, input: UpdateTaskInput) {
    const existing = await this.ensureTask(id);

    if (input.ownerId && input.ownerId !== existing.ownerId) {
      await this.ensureUser(input.ownerId);
    }

    if (input.reporterId && input.reporterId !== existing.reporterId) {
      await this.ensureUser(input.reporterId);
    }

    if (
      typeof input.progressPct === 'number' &&
      (input.progressPct < 0 || input.progressPct > 100)
    ) {
      throw badRequestError('TASK_INVALID_PROGRESS', 'Progress must be between 0 and 100');
    }

    const effortPlannedHours = toDecimal(input.effortPlannedHours);
    const effortLoggedHours = toDecimal(input.effortLoggedHours);

    return this.prisma.task.update({
      where: { id },
      data: {
        title: input.title,
        description: input.description,
        status: input.status,
        priority: input.priority,
        ownerId: input.ownerId,
        reporterId: input.reporterId ?? undefined,
        plannedStart: input.plannedStart ?? undefined,
        plannedEnd: input.plannedEnd ?? undefined,
        actualStart: input.actualStart ?? undefined,
        actualEnd: input.actualEnd ?? undefined,
        progressPct: input.progressPct ?? undefined,
        effortPlannedHours,
        effortLoggedHours,
        metadata: toJsonValue(input.metadata ?? undefined),
      },
      include: taskInclude,
    });
  }

  async deleteTask(id: string) {
    await this.ensureTask(id);
    await this.prisma.task.delete({ where: { id } });
  }

  async listDependencies(taskId: string) {
    await this.ensureTask(taskId);

    return this.prisma.taskDependency.findMany({
      where: { taskId },
      include: {
        dependsOn: {
          select: {
            id: true,
            title: true,
            status: true,
            projectId: true,
          },
        },
      },
      orderBy: { dependsOnTaskId: 'asc' },
    });
  }

  async createDependency(taskId: string, input: CreateDependencyInput) {
    const task = await this.ensureTask(taskId);

    if (taskId === input.dependsOnTaskId) {
      throw badRequestError('TASK_DEPENDENCY_SELF', 'Task cannot depend on itself');
    }

    const predecessor = await this.ensureTask(input.dependsOnTaskId);

    if (task.projectId !== predecessor.projectId) {
      throw badRequestError(
        'TASK_DEPENDENCY_PROJECT_MISMATCH',
        'Tasks must belong to the same project',
      );
    }

    const existing = await this.prisma.taskDependency.findUnique({
      where: {
        taskId_dependsOnTaskId: {
          taskId,
          dependsOnTaskId: input.dependsOnTaskId,
        },
      },
    });

    if (existing) {
      throw badRequestError('TASK_DEPENDENCY_EXISTS', 'Dependency already exists');
    }

    const dependencies = await this.prisma.taskDependency.findMany({
      where: { task: { projectId: task.projectId } },
      select: { taskId: true, dependsOnTaskId: true },
    });

    const adjacency = dependencies.reduce<Map<string, Set<string>>>((acc, dep) => {
      if (!acc.has(dep.taskId)) {
        acc.set(dep.taskId, new Set());
      }
      acc.get(dep.taskId)!.add(dep.dependsOnTaskId);
      return acc;
    }, new Map());

    const stack = [input.dependsOnTaskId];
    const visited = new Set<string>();

    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current === taskId) {
        throw badRequestError(
          'TASK_DEPENDENCY_CYCLE',
          'Dependency would create a cycle',
          'The selected dependency introduces a circular relationship',
        );
      }

      if (visited.has(current)) {
        continue;
      }
      visited.add(current);

      const next = adjacency.get(current);
      if (next) {
        next.forEach((neighbor) => {
          if (!visited.has(neighbor)) {
            stack.push(neighbor);
          }
        });
      }
    }

    return this.prisma.taskDependency.create({
      data: {
        id: uuidv7(),
        taskId,
        dependsOnTaskId: input.dependsOnTaskId,
        type: input.type ?? TaskDependencyType.FS,
        lagMinutes: input.lagMinutes ?? null,
      },
      include: {
        dependsOn: {
          select: {
            id: true,
            title: true,
            status: true,
            projectId: true,
          },
        },
      },
    });
  }

  async deleteDependency(taskId: string, dependencyId: string) {
    const dependency = await this.prisma.taskDependency.findUnique({
      where: { id: dependencyId },
      select: { id: true, taskId: true },
    });

    if (!dependency || dependency.taskId !== taskId) {
      throw notFoundError('TASK_DEPENDENCY_NOT_FOUND', 'Task dependency not found');
    }

    await this.prisma.taskDependency.delete({
      where: { id: dependencyId },
    });
  }

  private async ensureProject(id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!project) {
      throw notFoundError('PROJECT_NOT_FOUND', 'Project not found');
    }
  }

  private async ensureTask(id: string) {
    const task = await this.prisma.task.findUnique({ where: { id } });

    if (!task) {
      throw notFoundError('TASK_NOT_FOUND', 'Task not found');
    }

    return task;
  }

  private async ensureUser(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!user) {
      throw badRequestError('TASK_INVALID_USER', 'User not found');
    }
  }

  /**
   * Full-text search tasks with PostgreSQL ts_query
   * @param query Search query string
   * @param options Search options (limit, projectId, status filter)
   * @returns Array of tasks with relevance ranking
   */
  async searchTasks(
    query: string,
    options?: { limit?: number; projectId?: string; status?: TaskStatus }
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
        t."id",
        t."code",
        t."title",
        t."description",
        t."status",
        t."priority",
        t."projectId",
        t."progressPct",
        t."plannedStart",
        t."plannedEnd",
        t."createdAt",
        t."updatedAt",
        ts_rank(t."searchVector", to_tsquery('english', $1)) as rank,
        jsonb_build_object(
          'id', o."id",
          'fullName', o."fullName",
          'email', o."email"
        ) as owner,
        jsonb_build_object(
          'id', p."id",
          'code', p."code",
          'name', p."name"
        ) as project
      FROM "Task" t
      INNER JOIN "User" o ON t."ownerId" = o."id"
      INNER JOIN "Project" p ON t."projectId" = p."id"
      WHERE t."searchVector" @@ to_tsquery('english', $1)
    `;

    const params: Array<string> = [tsQuery];
    let paramIndex = 2;

    if (options?.projectId) {
      sql += ` AND t."projectId" = $${paramIndex}`;
      params.push(options.projectId);
      paramIndex++;
    }

    if (options?.status) {
      sql += ` AND t."status" = $${paramIndex}`;
      params.push(options.status);
      paramIndex++;
    }

    sql += ` ORDER BY rank DESC, t."updatedAt" DESC LIMIT ${limit}`;

    const results = await this.prisma.$queryRawUnsafe<
      Array<{
        id: string;
        code: string | null;
        title: string;
        description: string | null;
        status: TaskStatus;
        priority: TaskPriority;
        projectId: string;
        progressPct: number;
        plannedStart: Date | null;
        plannedEnd: Date | null;
        createdAt: Date;
        updatedAt: Date;
        rank: number;
        owner: { id: string; fullName: string; email: string };
        project: { id: string; code: string; name: string };
      }>
    >(sql, ...params);

    return results;
  }
}
