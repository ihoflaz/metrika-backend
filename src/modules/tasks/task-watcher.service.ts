import { PrismaClient } from '@prisma/client';
import { uuidv7 } from 'uuidv7';
import { badRequestError, notFoundError } from '../../common/errors';

export class TaskWatcherService {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async listWatchers(taskId: string) {
    await this.ensureTask(taskId);

    return this.prisma.taskWatcher.findMany({
      where: { taskId },
      orderBy: { createdAt: 'asc' },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
    });
  }

  async addWatcher(taskId: string, userId: string) {
    await this.ensureTask(taskId);
    await this.ensureUser(userId);

    const existing = await this.prisma.taskWatcher.findUnique({
      where: {
        taskId_userId: {
          taskId,
          userId,
        },
      },
    });

    if (existing) {
      throw badRequestError('TASK_WATCHER_EXISTS', 'Watcher already added for this task');
    }

    return this.prisma.taskWatcher.create({
      data: {
        id: uuidv7(),
        taskId,
        userId,
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
    });
  }

  async removeWatcher(taskId: string, watcherId: string) {
    const watcher = await this.prisma.taskWatcher.findUnique({
      where: { id: watcherId },
      select: { id: true, taskId: true },
    });

    if (!watcher || watcher.taskId !== taskId) {
      throw notFoundError('TASK_WATCHER_NOT_FOUND', 'Task watcher not found');
    }

    await this.prisma.taskWatcher.delete({
      where: { id: watcherId },
    });
  }

  private async ensureTask(id: string) {
    const task = await this.prisma.task.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!task) {
      throw notFoundError('TASK_NOT_FOUND', 'Task not found');
    }
  }

  private async ensureUser(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!user) {
      throw badRequestError('TASK_WATCHER_INVALID_USER', 'User not found');
    }
  }
}
