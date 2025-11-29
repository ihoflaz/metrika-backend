import { PrismaClient, TaskStatus, TaskPriority } from '@prisma/client';
import { createLogger } from '../../lib/logger';

const logger = createLogger({ name: 'KanbanService' });

export interface KanbanTask {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  kanbanPosition: number | null;
  ownerId: string;
  ownerName: string;
  plannedStart: Date | null;
  plannedEnd: Date | null;
  progressPct: number;
}

export interface KanbanColumn {
  status: TaskStatus;
  title: string;
  tasks: KanbanTask[];
  count: number;
}

export interface KanbanBoard {
  projectId: string;
  projectName: string;
  columns: KanbanColumn[];
  totalTasks: number;
}

export interface GanttTask {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  ownerId: string;
  ownerName: string;
  plannedStart: Date | null;
  plannedEnd: Date | null;
  actualStart: Date | null;
  actualEnd: Date | null;
  progressPct: number;
  parentTaskId: string | null;
  dependencies: string[]; // predecessor task IDs
}

export class KanbanService {
  private readonly prisma: PrismaClient;

  constructor(prismaClient: PrismaClient) {
    this.prisma = prismaClient;
  }

  /**
   * Status sırası (Kanban kolonları için)
   */
  private readonly columnOrder: TaskStatus[] = [
    'DRAFT',
    'PLANNED',
    'IN_PROGRESS',
    'BLOCKED',
    'ON_HOLD',
    'COMPLETED',
    'CANCELLED',
  ];

  /**
   * Kolon başlıkları
   */
  private readonly columnTitles: Record<TaskStatus, string> = {
    DRAFT: 'Taslak',
    PLANNED: 'Planlandı',
    IN_PROGRESS: 'Devam Ediyor',
    BLOCKED: 'Engellendi',
    ON_HOLD: 'Beklemede',
    COMPLETED: 'Tamamlandı',
    CANCELLED: 'İptal',
  };

  /**
   * Proje için Kanban board'u getir
   */
  async getKanbanBoard(projectId: string): Promise<KanbanBoard> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true },
    });

    if (!project) {
      throw new Error('Project not found');
    }

    // Tüm task'leri getir
    const tasks = await this.prisma.task.findMany({
      where: { projectId },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        kanbanPosition: true,
        ownerId: true,
        owner: {
          select: {
            fullName: true,
          },
        },
        plannedStart: true,
        plannedEnd: true,
        progressPct: true,
      },
      orderBy: [
        { status: 'asc' },
        { kanbanPosition: 'asc' },
        { createdAt: 'asc' },
      ],
    });

    // Status'lere göre grupla
    const columns: KanbanColumn[] = this.columnOrder.map((status) => {
      const statusTasks = tasks
        .filter((t) => t.status === status)
        .map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          kanbanPosition: t.kanbanPosition,
          ownerId: t.ownerId,
          ownerName: t.owner.fullName,
          plannedStart: t.plannedStart,
          plannedEnd: t.plannedEnd,
          progressPct: t.progressPct,
        }));

      return {
        status,
        title: this.columnTitles[status],
        tasks: statusTasks,
        count: statusTasks.length,
      };
    });

    logger.info({ projectId, totalTasks: tasks.length }, 'Kanban board retrieved');

    return {
      projectId,
      projectName: project.name,
      columns,
      totalTasks: tasks.length,
    };
  }

  /**
   * Task'ı yeni status'e taşı
   */
  async moveTask(
    taskId: string,
    newStatus: TaskStatus,
    position?: number
  ): Promise<void> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { status: true, projectId: true },
    });

    if (!task) {
      throw new Error('Task not found');
    }

    const oldStatus = task.status;

    // Aynı status içinde hareket
    if (oldStatus === newStatus) {
      if (position !== undefined) {
        await this.reorderTasksInStatus(task.projectId, newStatus, taskId, position);
      }
      return;
    }

    // Farklı status'e taşıma
    await this.prisma.$transaction(async (tx) => {
      // 1. Eski status'ten kaldır (pozisyonları düzelt)
      const oldStatusTasks = await tx.task.findMany({
        where: {
          projectId: task.projectId,
          status: oldStatus,
        },
        orderBy: { kanbanPosition: 'asc' },
        select: { id: true, kanbanPosition: true },
      });

      for (let i = 0; i < oldStatusTasks.length; i++) {
        await tx.task.update({
          where: { id: oldStatusTasks[i].id },
          data: { kanbanPosition: i },
        });
      }

      // 2. Yeni status'e ekle
      const newStatusTasks = await tx.task.findMany({
        where: {
          projectId: task.projectId,
          status: newStatus,
        },
        orderBy: { kanbanPosition: 'asc' },
        select: { id: true },
      });

      const targetPosition = position ?? newStatusTasks.length;

      // Hedef pozisyondan sonraki task'leri kaydır
      for (let i = targetPosition; i < newStatusTasks.length; i++) {
        await tx.task.update({
          where: { id: newStatusTasks[i].id },
          data: { kanbanPosition: i + 1 },
        });
      }

      // 3. Task'ı güncelle
      await tx.task.update({
        where: { id: taskId },
        data: {
          status: newStatus,
          kanbanPosition: targetPosition,
        },
      });
    });

    logger.info(
      { taskId, oldStatus, newStatus, position },
      'Task moved to new status'
    );
  }

  /**
   * Aynı status içinde task'leri yeniden sırala
   */
  async reorderTasksInStatus(
    projectId: string,
    status: TaskStatus,
    taskId: string,
    newPosition: number
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const tasks = await tx.task.findMany({
        where: { projectId, status },
        orderBy: { kanbanPosition: 'asc' },
        select: { id: true, kanbanPosition: true },
      });

      const taskIndex = tasks.findIndex((t) => t.id === taskId);
      if (taskIndex === -1) {
        throw new Error('Task not found in status column');
      }

      // Task'ı listeden çıkar
      const [movedTask] = tasks.splice(taskIndex, 1);

      // Yeni pozisyona ekle
      tasks.splice(newPosition, 0, movedTask);

      // Tüm pozisyonları güncelle
      for (let i = 0; i < tasks.length; i++) {
        await tx.task.update({
          where: { id: tasks[i].id },
          data: { kanbanPosition: i },
        });
      }
    });

    logger.info(
      { projectId, status, taskId, newPosition },
      'Tasks reordered in status column'
    );
  }

  /**
   * Toplu task yeniden sıralama (drag-drop için)
   */
  async reorderTasks(
    projectId: string,
    status: TaskStatus,
    taskOrder: string[]
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      for (let i = 0; i < taskOrder.length; i++) {
        await tx.task.update({
          where: { id: taskOrder[i] },
          data: { kanbanPosition: i },
        });
      }
    });

    logger.info(
      { projectId, status, taskCount: taskOrder.length },
      'Tasks batch reordered'
    );
  }

  /**
   * Gantt chart için veri getir
   */
  async getGanttData(projectId: string): Promise<GanttTask[]> {
    const tasks = await this.prisma.task.findMany({
      where: { projectId },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        ownerId: true,
        owner: {
          select: {
            fullName: true,
          },
        },
        plannedStart: true,
        plannedEnd: true,
        actualStart: true,
        actualEnd: true,
        progressPct: true,
        parentTaskId: true,
        predecessorLinks: {
          select: {
            dependsOnTaskId: true,
          },
        },
      },
      orderBy: [{ plannedStart: 'asc' }, { createdAt: 'asc' }],
    });

    const ganttTasks: GanttTask[] = tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      ownerId: t.ownerId,
      ownerName: t.owner.fullName,
      plannedStart: t.plannedStart,
      plannedEnd: t.plannedEnd,
      actualStart: t.actualStart,
      actualEnd: t.actualEnd,
      progressPct: t.progressPct,
      parentTaskId: t.parentTaskId,
      dependencies: t.predecessorLinks.map((link) => link.dependsOnTaskId),
    }));

    logger.info({ projectId, taskCount: ganttTasks.length }, 'Gantt data retrieved');

    return ganttTasks;
  }
}



