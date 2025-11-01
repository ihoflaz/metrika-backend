import { Queue, Worker, type Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { EmailService } from '../notifications/email.service';

interface ApprovalReminderJob {
  versionId: string;
  documentId: string;
}

interface ApprovalEscalationJob {
  versionId: string;
  documentId: string;
}

export class DocumentApprovalQueueService {
  private reminderQueue: Queue<ApprovalReminderJob>;
  private escalationQueue: Queue<ApprovalEscalationJob>;
  private reminderWorker?: Worker<ApprovalReminderJob>;
  private escalationWorker?: Worker<ApprovalEscalationJob>;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly emailService: EmailService,
    private readonly logger: Logger,
    private readonly redisConnection: { host: string; port: number },
  ) {
    // Create queues
    this.reminderQueue = new Queue<ApprovalReminderJob>('document-approval-reminder', {
      connection: this.redisConnection,
    });

    this.escalationQueue = new Queue<ApprovalEscalationJob>('document-approval-escalation', {
      connection: this.redisConnection,
    });
  }

  /**
   * Schedule reminder and escalation jobs when document version is submitted for approval
   */
  async scheduleApprovalJobs(versionId: string, documentId: string): Promise<void> {
    // Schedule reminder after 48 hours
    await this.reminderQueue.add(
      'approval-reminder',
      { versionId, documentId },
      {
        delay: 48 * 60 * 60 * 1000, // 48 hours in milliseconds
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    // Schedule escalation after 72 hours
    await this.escalationQueue.add(
      'approval-escalation',
      { versionId, documentId },
      {
        delay: 72 * 60 * 60 * 1000, // 72 hours in milliseconds
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    this.logger.info(
      { versionId, documentId },
      'Scheduled approval reminder (48h) and escalation (72h)',
    );
  }

  /**
   * Cancel all pending jobs for a document version (when approved/rejected)
   */
  async cancelApprovalJobs(versionId: string): Promise<void> {
    // Remove all jobs for this version from both queues
    const reminderJobs = await this.reminderQueue.getJobs(['delayed', 'waiting']);
    const escalationJobs = await this.escalationQueue.getJobs(['delayed', 'waiting']);

    for (const job of reminderJobs) {
      if (job.data.versionId === versionId) {
        await job.remove();
      }
    }

    for (const job of escalationJobs) {
      if (job.data.versionId === versionId) {
        await job.remove();
      }
    }

    this.logger.info({ versionId }, 'Cancelled all approval jobs for version');
  }

  /**
   * Start processing approval reminder jobs
   */
  startReminderWorker(): void {
    this.reminderWorker = new Worker<ApprovalReminderJob>(
      'document-approval-reminder',
      async (job: Job<ApprovalReminderJob>) => {
        await this.processReminderJob(job.data);
      },
      {
        connection: this.redisConnection,
        concurrency: 5,
      },
    );

    this.reminderWorker.on('completed', (job) => {
      this.logger.info({ jobId: job.id }, 'Approval reminder job completed');
    });

    this.reminderWorker.on('failed', (job, err) => {
      this.logger.error({ jobId: job?.id, error: err.message }, 'Approval reminder job failed');
    });

    this.logger.info('Started approval reminder worker');
  }

  /**
   * Start processing approval escalation jobs
   */
  startEscalationWorker(): void {
    this.escalationWorker = new Worker<ApprovalEscalationJob>(
      'document-approval-escalation',
      async (job: Job<ApprovalEscalationJob>) => {
        await this.processEscalationJob(job.data);
      },
      {
        connection: this.redisConnection,
        concurrency: 5,
      },
    );

    this.escalationWorker.on('completed', (job) => {
      this.logger.info({ jobId: job.id }, 'Approval escalation job completed');
    });

    this.escalationWorker.on('failed', (job, err) => {
      this.logger.error({ jobId: job?.id, error: err.message }, 'Approval escalation job failed');
    });

    this.logger.info('Started approval escalation worker');
  }

  /**
   * Process reminder job: Send email to pending approvers
   */
  private async processReminderJob(data: ApprovalReminderJob): Promise<void> {
    const { versionId, documentId } = data;

    // Check if version still needs approval
    const version = await this.prisma.documentVersion.findUnique({
      where: { id: versionId },
      include: {
        document: {
          include: {
            project: true,
          },
        },
        approvals: {
          include: {
            approver: true,
          },
        },
      },
    });

    if (!version || version.status !== 'IN_REVIEW') {
      this.logger.info({ versionId }, 'Version no longer in review, skipping reminder');
      return;
    }

    const pendingApprovers = version.approvals.filter((a) => a.decidedAt === null);

    if (pendingApprovers.length === 0) {
      this.logger.info({ versionId }, 'No pending approvers, skipping reminder');
      return;
    }

    // Send reminder emails
    const emails = pendingApprovers.map((a) => a.approver.email);
    const subject = `[Metrika] Hatırlatma: Onay bekleyen doküman - ${version.document.title}`;
    const text = `Merhaba,

"${version.document.title}" dokümanının ${version.versionNo}. versiyonu 48 saattir onayınızı bekliyor.

Proje: ${version.document.project.name}
Versiyon: ${version.versionNo}
Durum: Onay Bekliyor

Lütfen dokümanı inceleyin ve onay sürecini tamamlayın.

Doküman ID: ${documentId}
Versiyon ID: ${versionId}`;

    try {
      await this.emailService.sendEmail({
        to: emails,
        subject,
        text,
      });

      this.logger.info(
        { versionId, approverCount: emails.length },
        'Sent approval reminder emails',
      );
    } catch (error) {
      this.logger.error({ versionId, error }, 'Failed to send approval reminder emails');
      throw error;
    }
  }

  /**
   * Process escalation job: Notify project manager about delayed approval
   */
  private async processEscalationJob(data: ApprovalEscalationJob): Promise<void> {
    const { versionId, documentId } = data;

    // Check if version still needs approval
    const version = await this.prisma.documentVersion.findUnique({
      where: { id: versionId },
      include: {
        document: {
          include: {
            owner: true,
            project: {
              include: {
                members: {
                  where: {
                    role: 'PM',
                    leftAt: null,
                  },
                  include: {
                    user: true,
                  },
                },
              },
            },
          },
        },
        approvals: {
          include: {
            approver: true,
          },
        },
      },
    });

    if (!version || version.status !== 'IN_REVIEW') {
      this.logger.info({ versionId }, 'Version no longer in review, skipping escalation');
      return;
    }

    const pendingApprovers = version.approvals.filter((a) => a.decidedAt === null);

    if (pendingApprovers.length === 0) {
      this.logger.info({ versionId }, 'No pending approvers, skipping escalation');
      return;
    }

    // Send escalation email to document owner and project managers
    const projectManagers = version.document.project.members.map((m) => m.user.email);
    const recipients = [version.document.owner.email, ...projectManagers];
    const pendingApproverNames = pendingApprovers.map((a) => a.approver.fullName).join(', ');

    const subject = `[Metrika] ESKALASYON: 72 saattir onay bekleyen doküman - ${version.document.title}`;
    const text = `UYARI: Onay süresi aşıldı!

"${version.document.title}" dokümanının ${version.versionNo}. versiyonu 72 saattir onay bekliyor.

Proje: ${version.document.project.name}
Versiyon: ${version.versionNo}
Onay Bekleyen: ${pendingApproverNames}
Bekleyen Onaylar: ${pendingApprovers.length}

Lütfen onay sürecini hızlandırmak için gerekli aksiyonu alın.

Doküman ID: ${documentId}
Versiyon ID: ${versionId}`;

    try {
      await this.emailService.sendEmail({
        to: recipients,
        subject,
        text,
      });

      this.logger.info(
        { versionId, recipientCount: recipients.length },
        'Sent approval escalation emails',
      );
    } catch (error) {
      this.logger.error({ versionId, error }, 'Failed to send approval escalation emails');
      throw error;
    }
  }

  /**
   * Gracefully shutdown workers
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down approval queue workers');

    if (this.reminderWorker) {
      await this.reminderWorker.close();
    }

    if (this.escalationWorker) {
      await this.escalationWorker.close();
    }

    await this.reminderQueue.close();
    await this.escalationQueue.close();

    this.logger.info('Approval queue workers shut down');
  }
}
