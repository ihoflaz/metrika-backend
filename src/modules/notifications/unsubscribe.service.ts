import { PrismaClient } from '@prisma/client';
import { createLogger } from '../../lib/logger';
import { randomBytes } from 'crypto';

const logger = createLogger({ name: 'UnsubscribeService' });
const prisma = new PrismaClient();

export class UnsubscribeService {
  /**
   * Unsubscribe token oluştur
   */
  async generateToken(
    userId: string,
    email: string,
    notificationType?: string
  ): Promise<string> {
    const token = randomBytes(32).toString('hex');

    await prisma.unsubscribeToken.create({
      data: {
        token,
        userId,
        email,
        notificationType,
      },
    });

    logger.info({ userId, email, notificationType }, 'Unsubscribe token generated');

    return token;
  }

  /**
   * Token'ı kullan (unsubscribe işlemi)
   */
  async useToken(token: string): Promise<{
    success: boolean;
    userId: string;
    email: string;
    notificationType?: string;
  }> {
    const unsubscribeToken = await prisma.unsubscribeToken.findUnique({
      where: { token },
    });

    if (!unsubscribeToken) {
      throw new Error('Invalid unsubscribe token');
    }

    if (unsubscribeToken.usedAt) {
      throw new Error('Unsubscribe token already used');
    }

    // Token'ı kullanıldı olarak işaretle
    await prisma.unsubscribeToken.update({
      where: { token },
      data: { usedAt: new Date() },
    });

    logger.info(
      {
        userId: unsubscribeToken.userId,
        email: unsubscribeToken.email,
        notificationType: unsubscribeToken.notificationType,
      },
      'Unsubscribe token used'
    );

    return {
      success: true,
      userId: unsubscribeToken.userId,
      email: unsubscribeToken.email,
      notificationType: unsubscribeToken.notificationType || undefined,
    };
  }

  /**
   * Email log kaydet
   */
  async logEmail(data: {
    recipientEmail: string;
    recipientUserId?: string;
    subject: string;
    templateName: string;
    notificationType: string;
    deliveryStatus: 'sent' | 'failed';
    errorMessage?: string;
    messageId?: string;
  }): Promise<void> {
    await prisma.emailLog.create({
      data: {
        recipientEmail: data.recipientEmail,
        recipientUserId: data.recipientUserId,
        subject: data.subject,
        templateName: data.templateName,
        notificationType: data.notificationType,
        deliveryStatus: data.deliveryStatus,
        errorMessage: data.errorMessage,
        messageId: data.messageId,
      },
    });

    logger.info(
      {
        recipientEmail: data.recipientEmail,
        notificationType: data.notificationType,
        deliveryStatus: data.deliveryStatus,
      },
      'Email logged'
    );
  }

  /**
   * Kullanıcının email log'larını getir
   */
  async getUserEmailLogs(userId: string, limit = 50) {
    return prisma.emailLog.findMany({
      where: { recipientUserId: userId },
      orderBy: { sentAt: 'desc' },
      take: limit,
      select: {
        id: true,
        recipientEmail: true,
        subject: true,
        templateName: true,
        notificationType: true,
        sentAt: true,
        deliveryStatus: true,
        errorMessage: true,
      },
    });
  }
}

export const unsubscribeService = new UnsubscribeService();
