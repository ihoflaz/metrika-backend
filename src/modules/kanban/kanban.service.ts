import { PrismaClient, TaskStatus, type Task } from '@prisma/client';

export interface KanbanColumn {
  status: TaskStatus;
  label: string;
  tasks: Task[];
  totalTasks: number;
}

export interface KanbanBoard {
  projectId: string;
  columns: KanbanColumn[];
  totalTasks: number;
}

export interface MoveTaskRequest {
  taskId: string;
  targetStatus: TaskStatus;
  targetPosition: number;
}

export interface GanttTask {
  id: string;
  title: string;
  status: TaskStatus;
  owner: {
    id: string;
    fullName: string;
    email: string;
  };
  plannedStart: Date | null;
  plannedEnd: Date | null;
  actualStart: Date | null;
  actualEnd: Date | null;
  progressPct: number;
  children?: GanttTask[];
}

/**
 * KanbanService
 * 
 * Kanban board görünümü ve task pozisyon yönetimi.
 * 
 * Özellikler:
 * - Kanban board (status'e göre kolonlar)
 * - Task taşıma (drag & drop)
 * - Pozisyon yeniden sıralama
 * - Gantt chart verisi
 */
export class KanbanService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Projeye ait kanban board'u döndür
   * 
   * @param projectId - Proje ID
   * @returns Kanban board (status kolonları + tasklar)
   */
  async getBoard(projectId: string): Promise<KanbanBoard> {
    // Proje var mı kontrol et
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new Error('Project not found');
    }

    // Tüm taskları çek (status'e göre grupla)
    const tasks = await this.prisma.task.findMany({
      where: { projectId },
      orderBy: [{ status: 'asc' }, { kanbanPosition: 'asc' }, { createdAt: 'asc' }],
      include: {
        owner: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
    });

    // Status'leri tanımla (sıralama önemli - workflow)
    const statusOrder: TaskStatus[] = [
      'DRAFT',
      'PLANNED',
      'IN_PROGRESS',
      'BLOCKED',
      'ON_HOLD',
      'COMPLETED',
      'CANCELLED',
    ];

    const statusLabels: Record<TaskStatus, string> = {
      DRAFT: 'Taslak',
      PLANNED: 'Planlandı',
      IN_PROGRESS: 'Devam Ediyor',
      BLOCKED: 'Engellendi',
      ON_HOLD: 'Beklemede',
      COMPLETED: 'Tamamlandı',
      CANCELLED: 'İptal Edildi',
    };

    // Kolonları oluştur
    const columns: KanbanColumn[] = statusOrder.map((status) => {
      const columnTasks = tasks.filter((t) => t.status === status);
      return {
        status,
        label: statusLabels[status],
        tasks: columnTasks,
        totalTasks: columnTasks.length,
      };
    });

    return {
      projectId,
      columns,
      totalTasks: tasks.length,
    };
  }

  /**
   * Task'ı farklı status kolonuna taşı
   * 
   * @param request - Task ID, hedef status, hedef pozisyon
   * @returns Güncellenmiş task
   */
  async moveTask(request: MoveTaskRequest): Promise<Task> {
    const { taskId, targetStatus, targetPosition } = request;

    // Task var mı kontrol et
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      throw new Error('Task not found');
    }

    // Eğer status değişiyorsa
    if (task.status !== targetStatus) {
      // 1. Hedef kolondaki mevcut taskların pozisyonlarını kaydır
      await this.prisma.task.updateMany({
        where: {
          projectId: task.projectId,
          status: targetStatus,
          kanbanPosition: {
            gte: targetPosition,
          },
        },
        data: {
          kanbanPosition: {
            increment: 1,
          },
        },
      });

      // 2. Task'ı yeni status ve pozisyona taşı
      const updatedTask = await this.prisma.task.update({
        where: { id: taskId },
        data: {
          status: targetStatus,
          kanbanPosition: targetPosition,
          // Status değişikliğine göre timestamp'leri güncelle
          ...(targetStatus === 'IN_PROGRESS' && !task.actualStart
            ? { actualStart: new Date() }
            : {}),
          ...(targetStatus === 'COMPLETED' && !task.actualEnd
            ? { actualEnd: new Date(), progressPct: 100 }
            : {}),
        },
      });

      // 3. Eski kolondaki boşluğu kapat
      await this.prisma.task.updateMany({
        where: {
          projectId: task.projectId,
          status: task.status,
          kanbanPosition: {
            gt: task.kanbanPosition || 0,
          },
        },
        data: {
          kanbanPosition: {
            decrement: 1,
          },
        },
      });

      return updatedTask;
    } else {
      // Aynı kolon içinde sıralama değişikliği
      const currentPosition = task.kanbanPosition || 0;

      if (currentPosition === targetPosition) {
        return task; // Pozisyon aynı, değişiklik yok
      }

      // Yukarı mı aşağı mı taşınıyor?
      if (currentPosition < targetPosition) {
        // Aşağı taşıma: Araya giren taskları yukarı kaydır
        await this.prisma.task.updateMany({
          where: {
            projectId: task.projectId,
            status: targetStatus,
            kanbanPosition: {
              gt: currentPosition,
              lte: targetPosition,
            },
          },
          data: {
            kanbanPosition: {
              decrement: 1,
            },
          },
        });
      } else {
        // Yukarı taşıma: Araya giren taskları aşağı kaydır
        await this.prisma.task.updateMany({
          where: {
            projectId: task.projectId,
            status: targetStatus,
            kanbanPosition: {
              gte: targetPosition,
              lt: currentPosition,
            },
          },
          data: {
            kanbanPosition: {
              increment: 1,
            },
          },
        });
      }

      // Task'ı yeni pozisyona taşı
      return this.prisma.task.update({
        where: { id: taskId },
        data: {
          kanbanPosition: targetPosition,
        },
      });
    }
  }

  /**
   * Bir kolondaki tüm taskları yeniden sırala
   * 
   * @param projectId - Proje ID
   * @param status - Status kolonu
   * @param taskIds - Task ID'leri (yeni sıralama)
   */
  async reorderTasks(projectId: string, status: TaskStatus, taskIds: string[]): Promise<void> {
    // Proje ve status kontrolü
    const tasks = await this.prisma.task.findMany({
      where: {
        projectId,
        status,
        id: { in: taskIds },
      },
    });

    if (tasks.length !== taskIds.length) {
      throw new Error('Invalid task IDs or tasks not in specified status');
    }

    // Transaction ile tüm pozisyonları güncelle
    await this.prisma.$transaction(
      taskIds.map((taskId, index) =>
        this.prisma.task.update({
          where: { id: taskId },
          data: { kanbanPosition: index },
        })
      )
    );
  }

  /**
   * Proje için Gantt chart verisi döndür
   * 
   * @param projectId - Proje ID
   * @returns Hierarchical task tree (parent-child ilişkileriyle)
   */
  async getGantt(projectId: string): Promise<GanttTask[]> {
    // Tüm taskları çek (parent-child ilişkileriyle)
    const tasks = await this.prisma.task.findMany({
      where: { projectId },
      include: {
        owner: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
      orderBy: [{ plannedStart: 'asc' }, { createdAt: 'asc' }],
    });

    // Parent taskları (root level)
    const rootTasks = tasks.filter((t) => !t.parentTaskId);

    // Recursive helper: Children'ları bul
    const buildTree = (parentTask: typeof tasks[0]): GanttTask => {
      const children = tasks
        .filter((t) => t.parentTaskId === parentTask.id)
        .map((child) => buildTree(child));

      return {
        id: parentTask.id,
        title: parentTask.title,
        status: parentTask.status,
        owner: parentTask.owner,
        plannedStart: parentTask.plannedStart,
        plannedEnd: parentTask.plannedEnd,
        actualStart: parentTask.actualStart,
        actualEnd: parentTask.actualEnd,
        progressPct: parentTask.progressPct,
        children: children.length > 0 ? children : undefined,
      };
    };

    return rootTasks.map((task) => buildTree(task));
  }
}
