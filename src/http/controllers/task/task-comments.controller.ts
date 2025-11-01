import type { Request, Response } from 'express';
import { z } from 'zod';
import type {
  TaskCommentService,
  TaskCommentWithAuthor,
} from '../../../modules/tasks/task-comment.service';
import { validationError } from '../../../common/errors';
import { getRequestId } from '../../middleware/request-context';
import type { AuthenticatedRequestUser } from '../../types/auth-context';

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

  constructor(taskCommentService: TaskCommentService) {
    this.taskCommentService = taskCommentService;
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

    res.status(201).json({
      data: serializeComment(comment),
      meta: { requestId: getRequestId(res) },
    });
  };
}
