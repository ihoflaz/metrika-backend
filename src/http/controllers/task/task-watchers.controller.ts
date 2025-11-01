import type { Request, Response } from 'express';
import { z } from 'zod';
import type { TaskWatcherService } from '../../../modules/tasks/task-watcher.service';
import { validationError } from '../../../common/errors';
import { getRequestId } from '../../middleware/request-context';

const addWatcherSchema = z.object({
  userId: z.string().uuid(),
});

const serializeWatcher = (watcher: Awaited<ReturnType<TaskWatcherService['addWatcher']>>) => ({
  type: 'taskWatcher',
  id: watcher.id,
  attributes: {
    userId: watcher.user.id,
    createdAt: watcher.createdAt.toISOString(),
  },
  relationships: {
    user: {
      type: 'user',
      id: watcher.user.id,
      attributes: {
        email: watcher.user.email,
        fullName: watcher.user.fullName,
      },
    },
  },
});

export class TaskWatchersController {
  private readonly taskWatcherService: TaskWatcherService;

  constructor(taskWatcherService: TaskWatcherService) {
    this.taskWatcherService = taskWatcherService;
  }

  list = async (req: Request, res: Response) => {
    const watchers = await this.taskWatcherService.listWatchers(req.params.taskId);
    res.status(200).json({
      data: watchers.map((watcher) => serializeWatcher(watcher)),
      meta: { requestId: getRequestId(res) },
    });
  };

  add = async (req: Request, res: Response) => {
    const parsed = addWatcherSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError(parsed.error.flatten().fieldErrors);
    }

    const watcher = await this.taskWatcherService.addWatcher(req.params.taskId, parsed.data.userId);

    res.status(201).json({
      data: serializeWatcher(watcher),
      meta: { requestId: getRequestId(res) },
    });
  };

  remove = async (req: Request, res: Response) => {
    await this.taskWatcherService.removeWatcher(req.params.taskId, req.params.watcherId);
    res.status(204).send();
  };
}
