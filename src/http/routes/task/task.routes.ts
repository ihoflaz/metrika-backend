import { Router } from 'express';
import type { TasksController } from '../../controllers/task/tasks.controller';
import type { TaskCommentsController } from '../../controllers/task/task-comments.controller';
import type { TaskWatchersController } from '../../controllers/task/task-watchers.controller';
import { requirePermissions } from '../../middleware/auth/authentication';
import { PERMISSIONS } from '../../../modules/rbac/permissions';

export const createProjectTaskRouter = (controller: TasksController): Router => {
  const router = Router({ mergeParams: true });

  router.post('/', requirePermissions(PERMISSIONS.TASK_WRITE), controller.create);

  router.get('/', requirePermissions(PERMISSIONS.TASK_READ), controller.list);

  return router;
};

export const createTaskRouter = (
  controller: TasksController,
  commentsController: TaskCommentsController,
  watchersController: TaskWatchersController,
): Router => {
  const router = Router();

  router.patch('/:taskId', requirePermissions(PERMISSIONS.TASK_WRITE), controller.update);
  router.get(
    '/:taskId/dependencies',
    requirePermissions(PERMISSIONS.TASK_READ),
    controller.listDependencies,
  );
  router.post(
    '/:taskId/dependencies',
    requirePermissions(PERMISSIONS.TASK_WRITE),
    controller.addDependency,
  );
  router.delete(
    '/:taskId/dependencies/:dependencyId',
    requirePermissions(PERMISSIONS.TASK_WRITE),
    controller.deleteDependency,
  );

  router.get(
    '/:taskId/comments',
    requirePermissions(PERMISSIONS.TASK_READ),
    commentsController.list,
  );
  router.post(
    '/:taskId/comments',
    requirePermissions(PERMISSIONS.TASK_WRITE),
    commentsController.create,
  );

  router.get(
    '/:taskId/watchers',
    requirePermissions(PERMISSIONS.TASK_READ),
    watchersController.list,
  );
  router.post(
    '/:taskId/watchers',
    requirePermissions(PERMISSIONS.TASK_WRITE),
    watchersController.add,
  );
  router.delete(
    '/:taskId/watchers/:watcherId',
    requirePermissions(PERMISSIONS.TASK_WRITE),
    watchersController.remove,
  );

  return router;
};
