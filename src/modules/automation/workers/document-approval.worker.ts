import { Worker, Job } from 'bullmq';
import { QueueName, redisConnection } from '../../../config/queue.config';
import { createLogger } from '../../../lib/logger';
import { PrismaClient } from '@prisma/client';
import { notificationService } from '../../notifications/notification.service';

const logger = createLogger({ name: 'DocumentApprovalWorker' });
const prisma = new PrismaClient();

interface DocumentAutomationJobData {
  documentId: string;
  action: 'APPROVAL_REMINDER' | 'VERSION_CLEANUP' | 'VIRUS_SCAN';
  metadata?: Record<string, unknown>;
}

/**
 * Document Approval Worker
 * 
 * İşlevler:
 * 1. APPROVAL_REMINDER: Onay bekleyen dokümanlar için hatırlatma gönder
 * 2. VERSION_CLEANUP: Eski versiyonları temizle (30 gün+ eski)
 * 3. VIRUS_SCAN: Yeni upload'ları virus scan'e gönder
 * 
 * NOT: Bu worker Week 5'te (Document features) genişletilecek
 */
class DocumentApprovalWorker {
  private worker: Worker;

  constructor() {
    this.worker = new Worker<DocumentAutomationJobData>(
      QueueName.DOCUMENT_AUTOMATION,
      async (job: Job<DocumentAutomationJobData>) => {
        logger.info({ jobId: job.id, action: job.data.action }, '📄 Processing document automation job');

        try {
          switch (job.data.action) {
            case 'APPROVAL_REMINDER':
              await this.sendApprovalReminder(job.data.documentId);
              break;
            case 'VERSION_CLEANUP':
              await this.cleanupOldVersions(job.data.documentId);
              break;
            case 'VIRUS_SCAN':
              await this.scanDocument(job.data.documentId);
              break;
            default:
              throw new Error(`Unknown action: ${job.data.action}`);
          }

          logger.info({ jobId: job.id, documentId: job.data.documentId }, '✅ Document automation job completed');
        } catch (error) {
          logger.error({ jobId: job.id, error }, '❌ Document automation job failed');
          throw error;
        }
      },
      {
        connection: redisConnection,
        concurrency: 3,
      }
    );

    this.worker.on('completed', (job) => {
      logger.debug({ jobId: job.id }, 'Document automation job completed');
    });

    this.worker.on('failed', (job, err) => {
      logger.error({ jobId: job?.id, error: err }, 'Document automation job failed');
    });

    logger.info('🚀 DocumentApprovalWorker started');
  }

  /**
   * APPROVAL_REMINDER: Onay bekleyen dokümanlar için hatırlatma
   */
  private async sendApprovalReminder(documentId: string): Promise<void> {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: {
        owner: true,
        project: true,
        currentVersion: true,
      },
    });

    if (!document) {
      logger.warn({ documentId }, 'Document not found');
      return;
    }

    // Current version approval durumu kontrolü
    if (!document.currentVersion || document.currentVersion.status !== 'IN_REVIEW') {
      logger.debug({ documentId }, 'Document version not in review');
      return;
    }

    // Pending'de ne kadar süredir?
    const now = new Date();
    const uploadedAt = document.createdAt;
    const pendingDays = Math.floor((now.getTime() - uploadedAt.getTime()) / (1000 * 60 * 60 * 24));

    // 3 gün+ pending ise hatırlatma gönder
    if (pendingDays >= 3) {
      logger.info(
        { documentId, title: document.title, pendingDays },
        `📨 Sending approval reminder (pending for ${pendingDays} days)`
      );

      // Approval chain implementasyonu basit: document owner'a gönder
      // TODO (Week 5 - FR-34): Approval chain implementasyonu ile gerçek approver'lara gönder
      await notificationService.send({
        type: 'document-approval-reminder',
        documentId: document.id,
        documentName: document.title,
        projectName: document.project.name,
        approverName: document.owner.fullName,
        approverEmail: document.owner.email,
        pendingDays,
        documentUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/projects/${document.projectId}/documents/${document.id}`,
      });
    }
  }

  /**
   * VERSION_CLEANUP: Eski versiyonları temizle
   */
  private async cleanupOldVersions(documentId: string): Promise<void> {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      logger.warn({ documentId }, 'Document not found');
      return;
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // 30 günden eski versiyonları bul (verNo < currentVer - 3)
    // Şimdilik sadece log
    logger.info(
      { documentId, title: document.title },
      '🗑️ Version cleanup placeholder (S3 cleanup will be implemented in Week 5)'
    );

    // TODO (Week 5): S3'ten eski versiyonları sil
    // - Mevcut version'dan 3+ eski olanları bul
    // - S3'ten sil
    // - Database'den metadata temizle
  }

  /**
   * VIRUS_SCAN: Dokümanı virus scan'e gönder
   */
  private async scanDocument(documentId: string): Promise<void> {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: {
        currentVersion: true,
      },
    });

    if (!document) {
      logger.warn({ documentId }, 'Document not found');
      return;
    }

    logger.info(
      { 
        documentId, 
        title: document.title, 
        sizeBytes: document.currentVersion?.sizeBytes 
      },
      '🛡️ Virus scan placeholder (ClamAV integration in Week 8)'
    );

    // TODO (Week 8 - Security hardening): ClamAV integration
    // - S3'ten file download et
    // - ClamAV scan yap
    // - Sonucu kaydet
    // - Virus varsa document'ı quarantine et
  }

  async close(): Promise<void> {
    await this.worker.close();
    await prisma.$disconnect();
    logger.info('🛑 DocumentApprovalWorker stopped');
  }
}

// Singleton instance
let workerInstance: DocumentApprovalWorker | null = null;

export function startDocumentApprovalWorker(): DocumentApprovalWorker {
  if (!workerInstance) {
    workerInstance = new DocumentApprovalWorker();
  }
  return workerInstance;
}

export async function stopDocumentApprovalWorker(): Promise<void> {
  if (workerInstance) {
    await workerInstance.close();
    workerInstance = null;
  }
}
