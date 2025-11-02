import { PrismaClient, DocumentVersionStatus } from '@prisma/client';
import { getQueueService } from '../queue.service';
import { createLogger } from '../../../lib/logger';

const logger = createLogger({ name: 'DocumentReminderCron' });
const prisma = new PrismaClient();

/**
 * Document Approval Reminder Cron Job
 * 
 * Her 15 dakikada çalışır.
 * 
 * Kontroller:
 * 1. IN_REVIEW status'ünde 3+ gün olan dokümanlar
 */
export async function documentReminderCron(): Promise<void> {
  try {
    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const queueService = getQueueService();

    // IN_REVIEW'de 3+ gün bekleyen dokümanları bul
    const pendingDocuments = await prisma.documentVersion.findMany({
      where: {
        status: DocumentVersionStatus.IN_REVIEW,
        createdAt: {
          lte: threeDaysAgo,
        },
      },
      include: {
        document: {
          include: {
            owner: true,
            project: true,
          },
        },
        creator: true,
      },
    });

    logger.info(`Found ${pendingDocuments.length} pending documents (3+ days in review)`);

    for (const docVersion of pendingDocuments) {
      const pendingDays = Math.floor(
        (now.getTime() - docVersion.createdAt.getTime()) / (1000 * 60 * 60 * 24)
      );

      await queueService.addDocumentAutomationJob({
        documentId: docVersion.document.id,
        action: 'APPROVAL_REMINDER',
        metadata: {
          versionId: docVersion.id,
          versionNo: docVersion.versionNo,
          pendingDays,
          uploaderEmail: docVersion.creator.email,
        },
      });
    }

    logger.info({
      pendingDocuments: pendingDocuments.length,
    }, '✅ Document reminder check completed');
  } catch (error) {
    logger.error({ error }, '❌ Document reminder check failed');
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}
