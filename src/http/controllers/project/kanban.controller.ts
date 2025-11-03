import { Request, Response, NextFunction } from 'express';
import { KanbanService } from '../../../modules/projects/kanban.service';
import { z } from 'zod';
import { TaskStatus } from '@prisma/client';

const moveTaskSchema = z.object({
  status: z.nativeEnum(TaskStatus),
  position: z.number().int().min(0).optional(),
});

const reorderTasksSchema = z.object({
  status: z.nativeEnum(TaskStatus),
  taskOrder: z.array(z.string().uuid()),
});

export class KanbanController {
  constructor(private kanbanService: KanbanService) {}

  /**
   * GET /api/v1/projects/:projectId/kanban
   * Kanban board'u getir
   */
  getKanbanBoard = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { projectId } = req.params;

      const board = await this.kanbanService.getKanbanBoard(projectId);

      res.json(board);
    } catch (error) {
      next(error);
    }
  };

  /**
   * PATCH /api/v1/tasks/:taskId/move
   * Task'ı yeni status'e taşı
   */
  moveTask = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { taskId } = req.params;
      const validated = moveTaskSchema.parse(req.body);

      await this.kanbanService.moveTask(taskId, validated.status, validated.position);

      res.json({ message: 'Task moved successfully' });
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/v1/projects/:projectId/kanban/reorder
   * Task'leri toplu yeniden sırala
   */
  reorderTasks = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { projectId } = req.params;
      const validated = reorderTasksSchema.parse(req.body);

      await this.kanbanService.reorderTasks(
        projectId,
        validated.status,
        validated.taskOrder
      );

      res.json({ message: 'Tasks reordered successfully' });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/v1/projects/:projectId/gantt
   * Gantt chart verisi getir
   */
  getGanttData = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { projectId } = req.params;

      const tasks = await this.kanbanService.getGanttData(projectId);

      res.json({ tasks });
    } catch (error) {
      next(error);
    }
  };
}
