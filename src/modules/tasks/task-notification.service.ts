import { schedule, type ScheduledTask } from 'node-cron';
import { PrismaClient, TaskStatus, type Task } from '@prisma/client';
import type { Logger } from 'pino';
import type { EmailService } from '../notifications/email.service';
import {
  generateTaskCommentEmail,
  generateTaskOverdueEmail,
  type TaskCommentEmailData,
  type TaskOverdueEmailData,
} from '../notifications/email-templates';

interface NotifyWatchersParams {
  task: Task;
  commentText: string;
  commenterName: string;
  commenterEmail: string;
}

export class TaskNotificationService {
  private cronTask?: ScheduledTask;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly emailService: EmailService,
    private readonly logger: Logger,
  ) {}

  async notifyWatchers(params: NotifyWatchersParams): Promise<void> {
    const { task, commentText, commenterName, commenterEmail } = params;

    const watchers = await this.prisma.taskWatcher.findMany({
      where: {
        taskId: task.id,
      },
      include: {
        user: {
          select: {
            email: true,
            fullName: true,
          },
        },
      },
    });

    // Yorum yapan kişiye gönderme
    const recipients = watchers
      .map((w) => w.user.email)
      .filter((email) => email !== commenterEmail);

    if (recipients.length === 0) {
      return;
    }

    // Proje bilgisini al
    const project = await this.prisma.project.findUnique({
      where: { id: task.projectId },
      select: { name: true },
    });

    const emailData: TaskCommentEmailData = {
      taskTitle: task.title,
      taskStatus: task.status,
      taskId: task.id,
      commenterName,
      commenterEmail,
      commentText,
      projectName: project?.name,
    };

    await this.emailService.sendEmail({
      to: recipients,
      subject: `[Metrika] Yorum: ${task.title} görevine yeni yorum eklendi`,
      text: `Merhaba,

${commenterName} (${commenterEmail}) "${task.title}" (${task.status}) görevine yeni bir yorum ekledi:

${commentText}

Görev ID: ${task.id}`,
      html: generateTaskCommentEmail(emailData),
    });

    this.logger.info(
      { taskId: task.id, watcherCount: recipients.length },
      'Notified task watchers about new comment',
    );
  }

  start() {
    if (this.cronTask) {
      return;
    }

    this.cronTask = schedule('*/30 * * * *', () => {
      this.sendPlannedTaskReminders().catch((error) => {
        this.logger.error({ error }, 'Failed to execute planned task reminder cron job');
      });
    });
  }

  stop() {
    if (this.cronTask) {
      this.cronTask.stop();
      this.cronTask = undefined;
    }
  }

  async sendPlannedTaskReminders(referenceDate: Date = new Date()) {
    const cutoff = new Date(referenceDate.getTime() - 30 * 60 * 1000);

    const tasks = await this.prisma.task.findMany({
      where: {
        status: TaskStatus.PLANNED,
        plannedStart: {
          not: null,
          lt: referenceDate,
        },
        OR: [
          {
            lastReminderSentAt: null,
          },
          {
            lastReminderSentAt: {
              lt: cutoff,
            },
          },
        ],
      },
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
        project: {
          select: {
            name: true,
          },
        },
      },
    });

    await Promise.all(
      tasks.map(async (task) => {
        const recipients = new Map<string, { email: string; fullName: string }>();

        if (task.owner) {
          recipients.set(task.owner.id, {
            email: task.owner.email,
            fullName: task.owner.fullName,
          });
        }

        if (task.reporter) {
          recipients.set(task.reporter.id, {
            email: task.reporter.email,
            fullName: task.reporter.fullName,
          });
        }

        task.watchers.forEach((watcher) => {
          recipients.set(watcher.user.id, {
            email: watcher.user.email,
            fullName: watcher.user.fullName,
          });
        });

        if (recipients.size === 0) {
          this.logger.debug({ taskId: task.id }, 'No recipients for planned task reminder');
          return;
        }

        const emailData: TaskOverdueEmailData = {
          taskTitle: task.title,
          taskId: task.id,
          plannedStart: task.plannedStart?.toISOString() ?? 'Belirtilmemiş',
          projectName: task.project?.name,
        };

        const subject = `[Metrika] Planlanan görev gecikti: ${task.title}`;
        const text = [
          'Merhaba,',
          '',
          `"${task.title}" görevi planlanan başlangıç zamanını geçti.`,
          `Planlanan başlangıç: ${task.plannedStart?.toISOString() ?? 'Belirtilmemiş'}`,
          '',
          `Görev ID: ${task.id}`,
        ].join('\n');

        await this.emailService.sendEmail({
          to: [...recipients.values()].map((recipient) => recipient.email),
          subject,
          text,
          html: generateTaskOverdueEmail(emailData),
        });

        await this.prisma.task.update({
          where: { id: task.id },
          data: {
            lastReminderSentAt: referenceDate,
          },
        });
      }),
    );
  }
}
