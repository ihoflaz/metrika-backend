import type { Request, Response } from 'express';
import { z } from 'zod';
import type {
  TaskCommentService,
  TaskCommentWithAuthor,
} from '../../../modules/tasks/task-comment.service';
import { validationError } from '../../../common/errors';
import { getRequestId } from '../../middleware/request-context';
import type { AuthenticatedRequestUser } from '../../types/auth-context';
import type { AuditService } from '../../../modules/audit/audit.service';

const createCommentSchema = z.object({
  body: z.string().trim().min(1),
});

const serializeComment = (comment: TaskCommentWithAuthor) => ({
  type: 'taskComment',
  id: comment.id,
  attributes: {
    body: comment.body,
    authorId: comment.author.id,
    authorName: comment.author.fullName,
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
  },
  relationships: {
    author: {
      type: 'user',
      id: comment.author.id,
      attributes: {
        email: comment.author.email,
        fullName: comment.author.fullName,
      },
    },
  },
});

export class TaskCommentsController {
  private readonly taskCommentService: TaskCommentService;

  private readonly auditService: AuditService;

  constructor(taskCommentService: TaskCommentService, auditService: AuditService) {
    this.taskCommentService = taskCommentService;
    this.auditService = auditService;
  }

  list = async (req: Request, res: Response) => {
    const comments = await this.taskCommentService.listComments(req.params.taskId);
    res.status(200).json({
      data: comments.map((comment) => serializeComment(comment)),
      meta: { requestId: getRequestId(res) },
    });
  };

  create = async (req: Request, res: Response) => {
    const parsed = createCommentSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError(parsed.error.flatten().fieldErrors);
    }

    const { authUser } = res.locals as { authUser?: AuthenticatedRequestUser };
    if (!authUser) {
      throw validationError({ auth: ['Missing authenticated user'] });
    }

    const comment = await this.taskCommentService.createComment(
      req.params.taskId,
      authUser.id,
      parsed.data.body,
    );

    await this.auditService.logEvent('TASK_COMMENT_CREATED', {
      actorId: authUser.id,
      detail: `Added comment to task ${req.params.taskId}`,
      context: { requestId: getRequestId(res) },
      metadata: {
        taskId: req.params.taskId,
        commentId: comment.id,
      },
    });

    res.status(201).json({
      data: serializeComment(comment),
      meta: { requestId: getRequestId(res) },
    });
  };

  update = async (req: Request, res: Response) => {
    const parsed = createCommentSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError(parsed.error.flatten().fieldErrors);
    }

    const { authUser } = res.locals as { authUser?: AuthenticatedRequestUser };
    if (!authUser) {
      throw validationError({ auth: ['Missing authenticated user'] });
    }

    const comment = await this.taskCommentService.updateComment(
      req.params.taskId,
      req.params.commentId,
      authUser.id,
      parsed.data.body,
    );

    await this.auditService.logEvent('TASK_COMMENT_UPDATED', {
      actorId: authUser.id,
      detail: `Updated comment ${req.params.commentId}`,
      context: { requestId: getRequestId(res) },
      metadata: {
        taskId: req.params.taskId,
        commentId: req.params.commentId,
      },
    });

    res.status(200).json({
      data: serializeComment(comment),
      meta: { requestId: getRequestId(res) },
    });
  };

  remove = async (req: Request, res: Response) => {
    const { authUser } = res.locals as { authUser?: AuthenticatedRequestUser };
    if (!authUser) {
      throw validationError({ auth: ['Missing authenticated user'] });
    }

    await this.taskCommentService.deleteComment(
      req.params.taskId,
      req.params.commentId,
      authUser.id,
    );

    await this.auditService.logEvent('TASK_COMMENT_DELETED', {
      actorId: authUser.id,
      detail: `Deleted comment ${req.params.commentId}`,
      context: { requestId: getRequestId(res) },
      metadata: {
        taskId: req.params.taskId,
        commentId: req.params.commentId,
      },
    });

    res.status(204).send();
  };
}
