import { PrismaClient, TaskStatus, type Prisma } from '@prisma/client';
import { uuidv7 } from 'uuidv7';
import type { Logger } from '../../lib/logger';
import { badRequestError, notFoundError } from '../../common/errors';
import type { EmailService } from '../notifications/email.service';

const commentInclude = {
  author: {
    select: {
      id: true,
      email: true,
      fullName: true,
    },
  },
} as const;

export type TaskCommentWithAuthor = Prisma.TaskCommentGetPayload<{
  include: typeof commentInclude;
}>;

export class TaskCommentService {
  private readonly prisma: PrismaClient;

  private readonly emailService: EmailService;

  private readonly logger: Logger;

  constructor(prisma: PrismaClient, emailService: EmailService, logger: Logger) {
    this.prisma = prisma;
    this.emailService = emailService;
    this.logger = logger;
  }

  async listComments(taskId: string) {
    await this.ensureTask(taskId);

    return this.prisma.taskComment.findMany({
      where: { taskId },
      orderBy: { createdAt: 'asc' },
      include: commentInclude,
    });
  }

  async createComment(taskId: string, authorId: string, body: string) {
    if (body.trim().length === 0) {
      throw badRequestError('TASK_COMMENT_INVALID', 'Comment body cannot be empty');
    }

    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        owner: {
          select: {
            id: true,
            email: true,
            fullName: true,
          },
        },
        reporter: {
          select: {
            id: true,
            email: true,
            fullName: true,
          },
        },
        watchers: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                fullName: true,
              },
            },
          },
        },
      },
    });

    if (!task) {
      throw notFoundError('TASK_NOT_FOUND', 'Task not found');
    }

    const author = await this.prisma.user.findUnique({
      where: { id: authorId },
      select: { id: true, email: true, fullName: true },
    });

    if (!author) {
      throw badRequestError('TASK_COMMENT_INVALID_AUTHOR', 'Author user not found');
    }

    const comment = await this.prisma.taskComment.create({
      data: {
        id: uuidv7(),
        taskId,
        authorId,
        body,
      },
      include: commentInclude,
    });

    await this.notifyRecipients(taskId, task.title, task.status, author, task, body);

    return comment;
  }

  private async notifyRecipients(
    taskId: string,
    taskTitle: string,
    status: TaskStatus,
    author: { id: string; email: string; fullName: string },
    task: {
      owner: { id: string; email: string; fullName: string } | null;
      reporter: { id: string; email: string; fullName: string } | null;
      watchers: Array<{
        user: { id: string; email: string; fullName: string };
      }>;
    },
    body: string,
  ) {
    const recipientIds = new Map<string, { email: string; fullName: string }>();

    if (task.owner) {
      recipientIds.set(task.owner.id, {
        email: task.owner.email,
        fullName: task.owner.fullName,
      });
    }

    if (task.reporter) {
      recipientIds.set(task.reporter.id, {
        email: task.reporter.email,
        fullName: task.reporter.fullName,
      });
    }

    task.watchers.forEach((watcher) => {
      recipientIds.set(watcher.user.id, {
        email: watcher.user.email,
        fullName: watcher.user.fullName,
      });
    });

    recipientIds.delete(author.id);

    const recipients = [...recipientIds.values()].map((value) => value.email);

    if (recipients.length === 0) {
      this.logger.debug({ taskId }, 'No recipients for task comment notification');
      return;
    }

    const subject = `[Metrika] ${taskTitle} gorevine yeni yorum eklendi`;
    const text = [
      `Merhaba,`,
      ``,
      `${author.fullName} (${author.email}) "${taskTitle}" (${status}) gorevine yeni bir yorum ekledi:`,
      ``,
      body,
      ``,
      `Gorev ID: ${taskId}`,
    ].join('\n');

    await this.emailService.sendEmail({ to: recipients, subject, text });
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
}
