import { Router } from 'express';
import type { KanbanController } from './kanban.controller';

export const createKanbanRouter = (kanbanController: KanbanController) => {
  const router = Router({ mergeParams: true }); // projectId'yi parent route'tan al

  /**
   * GET /api/v1/projects/:projectId/kanban
   * 
   * Kanban board'u getir
   */
  router.get('/', kanbanController.getBoard);

  /**
   * PUT /api/v1/projects/:projectId/kanban/move
   * 
   * Task taşı (farklı kolon veya aynı kolon içinde)
   */
  router.put('/move', kanbanController.moveTask);

  /**
   * PUT /api/v1/projects/:projectId/kanban/reorder
   * 
   * Bir kolondaki taskları yeniden sırala
   */
  router.put('/reorder', kanbanController.reorderTasks);

  /**
   * GET /api/v1/projects/:projectId/gantt
   * 
   * Gantt chart verisi getir
   */
  router.get('/gantt', kanbanController.getGantt);

  return router;
};
