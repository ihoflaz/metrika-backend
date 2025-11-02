import type { Request, Response, NextFunction } from 'express';
import { KanbanService, type MoveTaskRequest } from './kanban.service';

export class KanbanController {
  constructor(private kanbanService: KanbanService) {}

  /**
   * GET /api/v1/projects/:projectId/kanban
   * 
   * Kanban board'u döndür (status kolonları + tasklar)
   */
  getBoard = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { projectId } = req.params;

      const board = await this.kanbanService.getBoard(projectId);

      res.json({
        data: board,
        meta: {
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * PUT /api/v1/projects/:projectId/kanban/move
   * 
   * Task'ı farklı status kolonuna taşı veya aynı kolon içinde sırala
   */
  moveTask = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { projectId } = req.params;
      const { taskId, targetStatus, targetPosition } = req.body as MoveTaskRequest;

      if (!taskId || !targetStatus || targetPosition === undefined) {
        return res.status(400).json({
          errors: [
            {
              code: 'VALIDATION_ERROR',
              title: 'Invalid request',
              detail: 'taskId, targetStatus, and targetPosition are required',
            },
          ],
        });
      }

      const updatedTask = await this.kanbanService.moveTask({
        taskId,
        targetStatus,
        targetPosition,
      });

      res.json({
        data: updatedTask,
        meta: {
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * PUT /api/v1/projects/:projectId/kanban/reorder
   * 
   * Bir kolondaki tüm taskları yeniden sırala
   */
  reorderTasks = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { projectId } = req.params;
      const { status, taskIds } = req.body as { status: string; taskIds: string[] };

      if (!status || !Array.isArray(taskIds)) {
        return res.status(400).json({
          errors: [
            {
              code: 'VALIDATION_ERROR',
              title: 'Invalid request',
              detail: 'status and taskIds (array) are required',
            },
          ],
        });
      }

      await this.kanbanService.reorderTasks(projectId, status as any, taskIds);

      res.json({
        data: { success: true },
        meta: {
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/v1/projects/:projectId/gantt
   * 
   * Gantt chart verisi döndür (hierarchical task tree)
   */
  getGantt = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { projectId } = req.params;

      const ganttData = await this.kanbanService.getGantt(projectId);

      res.json({
        data: ganttData,
        meta: {
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  };
}
