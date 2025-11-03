/**
 * Document Approval Worker
 * 
 * Monitors pending document approvals and sends reminders
 * to approvers. Helps ensure timely document reviews.
 */

import { Worker, Job } from 'bullmq';
import { PrismaClient, DocumentVersionStatus } from '@prisma/client';
import { redisConnection, QueueName } from '../../config/queue.config';
import { getQueueService } from './queue.service';
import { logger } from '../../lib/logger';

interface DocumentApprovalJobData {
  action: 'PROCESS_PENDING_APPROVALS' | 'SEND_APPROVAL_REMINDER';
  versionId?: string;
  documentId?: string;
}

export class DocumentApprovalWorker {
  private worker: Worker<DocumentApprovalJobData>;

  constructor(private prisma: PrismaClient) {
    this.worker = new Worker<DocumentApprovalJobData>(
      QueueName.DOCUMENT_AUTOMATION,
      async (job) => this.processJob(job),
      {
        connection: redisConnection,
        concurrency: 5,
      }
    );

    this.setupEventHandlers();
    logger.info('📄 Document Approval Worker started');
  }

  private setupEventHandlers(): void {
    this.worker.on('completed', (job) => {
      logger.info({ jobId: job.id, action: job.data.action }, '✅ Document approval job completed');
    });

    this.worker.on('failed', (job, err) => {
      logger.error(
        { jobId: job?.id, action: job?.data.action, error: err.message },
        '❌ Document approval job failed'
      );
    });
  }

  private async processJob(job: Job<DocumentApprovalJobData>): Promise<void> {
    const { action, versionId, documentId } = job.data;

    switch (action) {
      case 'PROCESS_PENDING_APPROVALS':
        await this.processPendingApprovals();
        break;

      case 'SEND_APPROVAL_REMINDER':
        if (versionId) {
          await this.sendApprovalReminder(versionId);
        }
        break;

      default:
        logger.warn({ action }, 'Unknown document approval action');
    }
  }

  /**
   * Process pending document approvals and send reminders
   * for documents that have been waiting for approval > 48 hours
   */
  private async processPendingApprovals(): Promise<void> {
    const cutoffDate = new Date(Date.now() - 48 * 60 * 60 * 1000); // 48 hours ago

    // Find document versions pending approval
    const pendingVersions = await this.prisma.documentVersion.findMany({
      where: {
        status: DocumentVersionStatus.IN_REVIEW,
        createdAt: {
          lt: cutoffDate,
        },
      },
      include: {
        document: {
          include: {
            owner: {
              select: { email: true, fullName: true },
            },
            project: {
              select: { name: true, code: true },
            },
          },
        },
        creator: {
          select: { email: true, fullName: true },
        },
        approvals: {
          include: {
            approver: {
              select: { email: true, fullName: true },
            },
          },
        },
      },
      take: 100,
    });

    logger.info({ count: pendingVersions.length }, '🔍 Found pending document approvals');

    const queueService = getQueueService();

    for (const version of pendingVersions) {
      // Parse approval chain to find pending approvers
      const approvalChain = version.approvalChain as any;
      if (!approvalChain || !Array.isArray(approvalChain.approvers)) {
        logger.warn({ versionId: version.id }, 'Invalid approval chain structure');
        continue;
      }

      // Get list of users who have already approved
      const approvedUserIds = new Set(
        version.approvals
          .filter(a => a.decision === 'APPROVED')
          .map(a => a.approverId)
      );

      // Find pending approvers (not yet approved)
      const pendingApprovers = approvalChain.approvers.filter(
        (approverId: string) => !approvedUserIds.has(approverId)
      );

      if (pendingApprovers.length === 0) {
        continue;
      }

      // Fetch approver details
      const approvers = await this.prisma.user.findMany({
        where: {
          id: { in: pendingApprovers },
        },
        select: {
          id: true,
          email: true,
          fullName: true,
        },
      });

      // Calculate days pending
      const daysPending = Math.floor(
        (Date.now() - version.createdAt.getTime()) / (1000 * 60 * 60 * 24)
      );

      // Send reminder to each pending approver
      for (const approver of approvers) {
        if (approver.email) {
          await queueService.sendTemplateEmail({
            to: [approver.email],
            cc: version.document.owner.email ? [version.document.owner.email] : undefined,
            template: 'document-approval-reminder',
            data: {
              approverName: approver.fullName,
              documentTitle: version.document.title,
              documentType: version.document.docType,
              versionNo: version.versionNo,
              projectName: version.document.project.name,
              projectCode: version.document.project.code,
              creatorName: version.creator.fullName,
              daysPending,
              documentId: version.documentId,
              versionId: version.id,
            },
            priority: 3,
          });
        }
      }
    }

    logger.info({ processed: pendingVersions.length }, '✅ Pending approvals check completed');
  }

  /**
   * Send approval reminder for a specific document version
   */
  private async sendApprovalReminder(versionId: string): Promise<void> {
    const version = await this.prisma.documentVersion.findUnique({
      where: { id: versionId },
      include: {
        document: {
          include: {
            owner: {
              select: { email: true, fullName: true },
            },
            project: {
              select: { name: true, code: true },
            },
          },
        },
        creator: {
          select: { email: true, fullName: true },
        },
        approvals: {
          include: {
            approver: {
              select: { id: true, email: true, fullName: true },
            },
          },
        },
      },
    });

    if (!version) {
      logger.warn({ versionId }, '⚠️ Document version not found for approval reminder');
      return;
    }

    if (version.status !== DocumentVersionStatus.IN_REVIEW) {
      logger.info({ versionId, status: version.status }, 'Document not in review status');
      return;
    }

    // Parse approval chain
    const approvalChain = version.approvalChain as any;
    if (!approvalChain || !Array.isArray(approvalChain.approvers)) {
      logger.warn({ versionId }, 'Invalid approval chain structure');
      return;
    }

    // Find pending approvers
    const approvedUserIds = new Set(
      version.approvals
        .filter(a => a.decision === 'APPROVED')
        .map(a => a.approverId)
    );

    const pendingApprovers = approvalChain.approvers.filter(
      (approverId: string) => !approvedUserIds.has(approverId)
    );

    if (pendingApprovers.length === 0) {
      logger.info({ versionId }, 'No pending approvers found');
      return;
    }

    // Fetch approver details
    const approvers = await this.prisma.user.findMany({
      where: {
        id: { in: pendingApprovers },
      },
      select: {
        email: true,
        fullName: true,
      },
    });

    const queueService = getQueueService();
    const daysPending = Math.floor(
      (Date.now() - version.createdAt.getTime()) / (1000 * 60 * 60 * 24)
    );

    for (const approver of approvers) {
      if (approver.email) {
        await queueService.sendTemplateEmail({
          to: [approver.email],
          template: 'document-approval-reminder',
          data: {
            approverName: approver.fullName,
            documentTitle: version.document.title,
            documentType: version.document.docType,
            versionNo: version.versionNo,
            projectName: version.document.project.name,
            projectCode: version.document.project.code,
            creatorName: version.creator.fullName,
            daysPending,
            documentId: version.documentId,
            versionId: version.id,
          },
          priority: 4,
        });
      }
    }

    logger.info({ versionId, approverCount: approvers.length }, '📧 Approval reminders sent');
  }

  /**
   * Close worker and cleanup
   */
  async close(): Promise<void> {
    await this.worker.close();
    logger.info('📄 Document Approval Worker stopped');
  }
}

// Singleton instance
let workerInstance: DocumentApprovalWorker | null = null;

export function getDocumentApprovalWorker(prisma: PrismaClient): DocumentApprovalWorker {
  if (!workerInstance) {
    workerInstance = new DocumentApprovalWorker(prisma);
  }
  return workerInstance;
}
