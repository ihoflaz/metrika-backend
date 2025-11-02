import { Request, Response, NextFunction } from 'express';
import { kanbanService } from '../../../modules/projects/kanban.service';
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

/**
 * GET /api/v1/projects/:projectId/kanban
 * Kanban board'u getir
 */
export async function getKanbanBoard(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const { projectId } = req.params;

    const board = await kanbanService.getKanbanBoard(projectId);

    res.json(board);
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/v1/tasks/:taskId/move
 * Task'ı yeni status'e taşı
 */
export async function moveTask(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const { taskId } = req.params;
    const validated = moveTaskSchema.parse(req.body);

    await kanbanService.moveTask(taskId, validated.status, validated.position);

    res.json({ message: 'Task moved successfully' });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/v1/projects/:projectId/kanban/reorder
 * Task'leri toplu yeniden sırala
 */
export async function reorderTasks(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const { projectId } = req.params;
    const validated = reorderTasksSchema.parse(req.body);

    await kanbanService.reorderTasks(
      projectId,
      validated.status,
      validated.taskOrder
    );

    res.json({ message: 'Tasks reordered successfully' });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/v1/projects/:projectId/gantt
 * Gantt chart verisi getir
 */
export async function getGanttData(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const { projectId } = req.params;

    const tasks = await kanbanService.getGanttData(projectId);

    res.json({ tasks });
  } catch (error) {
    next(error);
  }
}
