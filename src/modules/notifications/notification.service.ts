import { PrismaClient } from '@prisma/client';
import { EmailService } from './email.service';
import { emailTemplateService } from './email-template.service';
import { createLogger } from '../../lib/logger';
import { loadAppConfig } from '../../config/app-config';
import { getQueueService } from '../automation/queue.service';

const logger = createLogger({ name: 'NotificationService' });
const prisma = new PrismaClient();
const appConfig = loadAppConfig();
const queueService = getQueueService();

export interface TaskDelayedNotification {
  type: 'task-delayed';
  taskId: string;
  taskTitle: string;
  projectName: string;
  ownerName: string;
  ownerEmail: string;
  delayDays: number;
  taskUrl: string;
}

export interface TaskAssignedNotification {
  type: 'task-assigned';
  taskId: string;
  taskTitle: string;
  projectName: string;
  assignedToName: string;
  assignedToEmail: string;
  assignedByName: string;
  plannedStart?: Date;
  plannedEnd?: Date;
  taskUrl: string;
}

export interface TaskCompletedNotification {
  type: 'task-completed';
  taskId: string;
  taskTitle: string;
  projectName: string;
  completedByName: string;
  completedByEmail: string;
  taskUrl: string;
}

export interface TaskEscalatedNotification {
  type: 'task-escalated';
  taskId: string;
  taskTitle: string;
  projectName: string;
  ownerName: string;
  ownerEmail: string;
  escalationLevel: 'warning' | 'critical';
  delayDays: number;
  taskUrl: string;
  escalatedToName: string;
  escalatedToEmail: string;
}

export interface KPIBreachNotification {
  type: 'kpi-breach';
  kpiId: string;
  kpiName: string;
  currentValue: number;
  targetValue: number;
  thresholdValue: number;
  deviation: number;
  severity: 'warning' | 'critical';
  ownerName: string;
  ownerEmail: string;
  kpiUrl: string;
}

export interface DocumentApprovalReminderNotification {
  type: 'document-approval-reminder';
  documentId: string;
  documentName: string;
  projectName: string;
  approverName: string;
  approverEmail: string;
  pendingDays: number;
  documentUrl: string;
}

export interface DocumentApprovedNotification {
  type: 'document-approved';
  documentId: string;
  documentName: string;
  projectName: string;
  uploaderName: string;
  uploaderEmail: string;
  approverName: string;
  documentUrl: string;
}

export interface WelcomeNotification {
  type: 'welcome';
  userName: string;
  userEmail: string;
  loginUrl: string;
  setupGuideUrl?: string;
}

export interface WeeklyDigestNotification {
  type: 'weekly-digest';
  userName: string;
  userEmail: string;
  weekStartDate: string;
  weekEndDate: string;
  tasksCompleted: number;
  tasksInProgress: number;
  tasksOverdue: number;
  upcomingDeadlines: Array<{
    taskTitle: string;
    projectName: string;
    dueDate: string;
    taskUrl: string;
  }>;
  dashboardUrl: string;
}

export type NotificationData =
  | TaskDelayedNotification
  | TaskAssignedNotification
  | TaskCompletedNotification
  | TaskEscalatedNotification
  | KPIBreachNotification
  | DocumentApprovalReminderNotification
  | DocumentApprovedNotification
  | WelcomeNotification
  | WeeklyDigestNotification;

type NotificationContent = {
  title: string;
  message: string;
};

/**
 * Merkezi Notification Service
 * 
 * TÃ¼m worker'larÄ±n kullandÄ±ÄŸÄ± notification gÃ¶nderim servisi.
 * Email template seÃ§imi ve gÃ¶nderimini yÃ¶netir.
 */
export class NotificationService {
  private emailService: EmailService;

  constructor() {
    this.emailService = new EmailService(appConfig, logger);
  }

  /**
   * Notification gÃ¶nder (template'e gÃ¶re)
   */
  async send(notification: NotificationData): Promise<boolean> {
    try {
      const templateName = this.getTemplateName(notification.type);
      const templateData = this.prepareTemplateData(notification);
      const recipient = this.getRecipient(notification);

      logger.info(
        {
          type: notification.type,
          recipient,
          templateName,
        },
        'Sending notification'
      );

      const result = await this.emailService.sendTemplateEmail({
        to: [recipient],
        template: templateName,
        data: templateData,
      });

      if (result.success) {
        logger.info(
          {
            type: notification.type,
            recipient,
            messageId: result.messageId,
          },
          'Notification sent successfully'
        );
        await this.dispatchSecondaryChannels(recipient, notification, templateData);
        return true;
      } else {
        logger.error(
          {
            type: notification.type,
            recipient,
            error: result.error,
          },
          'Notification sending failed'
        );
        return false;
      }
    } catch (error) {
      logger.error(
        {
          notification,
          error,
        },
        'Failed to send notification'
      );
      return false;
    }
  }

  /**
   * Batch notification gÃ¶nder
   */
  async sendBatch(notifications: NotificationData[]): Promise<number> {
    let successCount = 0;

    for (const notification of notifications) {
      const success = await this.send(notification);
      if (success) {
        successCount++;
      }

      // Rate limiting
      await this.delay(100);
    }

    logger.info(
      {
        total: notifications.length,
        success: successCount,
        failed: notifications.length - successCount,
      },
      'Batch notification sending completed'
    );

    return successCount;
  }

  /**
   * Template ismini notification type'dan belirle
   */
  private getTemplateName(type: NotificationData['type']): string {
    const templateMap: Record<NotificationData['type'], string> = {
      'task-delayed': 'task-delayed',
      'task-assigned': 'task-assigned',
      'task-completed': 'task-completed',
      'task-escalated': 'task-escalated',
      'kpi-breach': 'kpi-breach',
      'document-approval-reminder': 'document-approval-reminder',
      'document-approved': 'document-approved',
      'welcome': 'welcome',
      'weekly-digest': 'weekly-digest',
    };

    return templateMap[type];
  }

  /**
   * Template data'yÄ± hazÄ±rla
   */
  private prepareTemplateData(notification: NotificationData): Record<string, any> {
    switch (notification.type) {
      case 'task-delayed':
        return {
          taskTitle: notification.taskTitle,
          projectName: notification.projectName,
          ownerName: notification.ownerName,
          delayDays: notification.delayDays,
          taskUrl: notification.taskUrl,
          currentYear: new Date().getFullYear(),
        };

      case 'task-assigned':
        return {
          taskTitle: notification.taskTitle,
          projectName: notification.projectName,
          assignedToName: notification.assignedToName,
          assignedByName: notification.assignedByName,
          plannedStart: notification.plannedStart,
          plannedEnd: notification.plannedEnd,
          taskUrl: notification.taskUrl,
          currentYear: new Date().getFullYear(),
        };

      case 'task-completed':
        return {
          taskTitle: notification.taskTitle,
          projectName: notification.projectName,
          completedByName: notification.completedByName,
          taskUrl: notification.taskUrl,
          currentYear: new Date().getFullYear(),
        };

      case 'task-escalated':
        return {
          taskTitle: notification.taskTitle,
          projectName: notification.projectName,
          ownerName: notification.ownerName,
          escalationLevel: notification.escalationLevel,
          delayDays: notification.delayDays,
          taskUrl: notification.taskUrl,
          escalatedToName: notification.escalatedToName,
          currentYear: new Date().getFullYear(),
        };

      case 'kpi-breach':
        return {
          kpiName: notification.kpiName,
          currentValue: notification.currentValue,
          targetValue: notification.targetValue,
          thresholdValue: notification.thresholdValue,
          deviation: notification.deviation,
          severity: notification.severity,
          ownerName: notification.ownerName,
          kpiUrl: notification.kpiUrl,
          currentYear: new Date().getFullYear(),
        };

      case 'document-approval-reminder':
        return {
          documentName: notification.documentName,
          projectName: notification.projectName,
          approverName: notification.approverName,
          pendingDays: notification.pendingDays,
          documentUrl: notification.documentUrl,
          currentYear: new Date().getFullYear(),
        };

      case 'document-approved':
        return {
          documentName: notification.documentName,
          projectName: notification.projectName,
          uploaderName: notification.uploaderName,
          approverName: notification.approverName,
          documentUrl: notification.documentUrl,
          currentYear: new Date().getFullYear(),
        };

      case 'welcome':
        return {
          userName: notification.userName,
          loginUrl: notification.loginUrl,
          setupGuideUrl: notification.setupGuideUrl || `${process.env.FRONTEND_URL}/guide`,
          currentYear: new Date().getFullYear(),
        };

      case 'weekly-digest':
        return {
          userName: notification.userName,
          weekStartDate: notification.weekStartDate,
          weekEndDate: notification.weekEndDate,
          tasksCompleted: notification.tasksCompleted,
          tasksInProgress: notification.tasksInProgress,
          tasksOverdue: notification.tasksOverdue,
          upcomingDeadlines: notification.upcomingDeadlines,
          dashboardUrl: notification.dashboardUrl,
          currentYear: new Date().getFullYear(),
        };

      default:
        return {};
    }
  }

  /**
   * AlÄ±cÄ± email'ini belirle
   */
  private getRecipient(notification: NotificationData): string {
    switch (notification.type) {
      case 'task-delayed':
        return notification.ownerEmail;
      case 'task-assigned':
        return notification.assignedToEmail;
      case 'task-completed':
        return notification.completedByEmail;
      case 'task-escalated':
        return notification.escalatedToEmail;
      case 'kpi-breach':
        return notification.ownerEmail;
      case 'document-approval-reminder':
        return notification.approverEmail;
      case 'document-approved':
        return notification.uploaderEmail;
      default:
        throw new Error(`Unknown notification type: ${(notification as any).type}`);
    }
  }

  private async dispatchSecondaryChannels(
    recipientEmail: string,
    notification: NotificationData,
    templateData: Record<string, unknown>,
  ) {
    try {
      const content = this.buildContent(notification);
      await Promise.all([
        this.dispatchInAppNotification(recipientEmail, notification, content, templateData),
        this.dispatchWebhookNotification(notification, content, templateData),
      ]);
    } catch (error) {
      logger.error(
        { notificationType: notification.type, error },
        'Failed to dispatch secondary notification channels',
      );
    }
  }

  private async dispatchInAppNotification(
    recipientEmail: string,
    notification: NotificationData,
    content: NotificationContent,
    templateData: Record<string, unknown>,
  ) {
    const user = await prisma.user.findUnique({
      where: { email: recipientEmail },
      select: { id: true },
    });

    if (!user) {
      return;
    }

    await queueService.addNotificationJob({
      type: 'IN_APP',
      userId: user.id,
      template: notification.type,
      payload: {
        title: content.title,
        message: content.message,
        data: templateData,
      },
    });
  }

  private async dispatchWebhookNotification(
    notification: NotificationData,
    content: NotificationContent,
    templateData: Record<string, unknown>,
  ) {
    await queueService.addNotificationJob({
      type: 'WEBHOOK',
      template: notification.type,
      event: notification.type,
      payload: {
        title: content.title,
        message: content.message,
        data: templateData,
      },
    });
  }

  private buildContent(notification: NotificationData): NotificationContent {
    switch (notification.type) {
      case 'task-delayed':
        return {
          title: `Görev gecikti: ${notification.taskTitle}`,
          message: `${notification.projectName} projesinde ${notification.delayDays} gündür bekleyen görev mevcut.`,
        };
      case 'task-assigned':
        return {
          title: `Yeni görev ataması: ${notification.taskTitle}`,
          message: `${notification.assignedByName}, görevi ${notification.assignedToName} kişisine atadı.`,
        };
      case 'task-completed':
        return {
          title: `Görev tamamlandı: ${notification.taskTitle}`,
          message: `${notification.completedByName} görevi tamamladı.`,
        };
      case 'task-escalated':
        return {
          title: `Görev eskalasyonu: ${notification.taskTitle}`,
          message: `${notification.delayDays} gündür bekleyen görev ${notification.escalationLevel} seviyesine yükseltildi.`,
        };
      case 'kpi-breach':
        return {
          title: `KPI ihlali: ${notification.kpiName}`,
          message: `Mevcut değer ${notification.currentValue} ile ${notification.severity.toUpperCase()} seviyesinde.`,
        };
      case 'document-approval-reminder':
        return {
          title: `Doküman onay hatırlatması: ${notification.documentName}`,
          message: `${notification.pendingDays} gündür onay bekliyor.`,
        };
      case 'document-approved':
        return {
          title: `Doküman onaylandı: ${notification.documentName}`,
          message: `${notification.approverName} tarafından onaylandı.`,
        };
      case 'welcome':
        return {
          title: 'Metrika’ya hoş geldiniz!',
          message: `${notification.userName}, giriş yaparak kuruluma devam edebilirsiniz.`,
        };
      case 'weekly-digest':
        return {
          title: `Haftalık özet (${notification.weekStartDate} - ${notification.weekEndDate})`,
          message: `Tamamlanan görevler: ${notification.tasksCompleted}, devam eden: ${notification.tasksInProgress}, geciken: ${notification.tasksOverdue}.`,
        };
      default:
        return {
          title: notification.type,
          message: '',
        };
    }
  }
  /**
   * Rate limiting helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Email service'i kapat (graceful shutdown)
   */
  async close(): Promise<void> {
    await this.emailService.close();
  }
}

// Singleton instance
export const notificationService = new NotificationService();

