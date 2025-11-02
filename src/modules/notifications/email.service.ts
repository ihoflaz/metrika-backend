import { createTransport, type Transporter } from 'nodemailer';
import type { Logger } from '../../lib/logger';
import type { AppConfig } from '../../config/app-config';
import { emailTemplateService } from './email-template.service';
import { unsubscribeService } from './unsubscribe.service';

export interface SendEmailOptions {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: Array<{
    filename: string;
    content?: Buffer | string;
    path?: string;
  }>;
  // Email logging için metadata
  userId?: string; // Alıcının user ID'si (varsa)
  templateName?: string; // Template adı (template email için)
  notificationType?: string; // Notification tipi (bildirim sistemi için)
}

export interface TemplateEmailOptions {
  to: string[];
  cc?: string[];
  bcc?: string[];
  template: string;
  data: Record<string, any>;
  attachments?: SendEmailOptions['attachments'];
  // Email logging için
  userId?: string;
  notificationType?: string;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
  recipients: string[];
}

export class EmailService {
  private readonly transporter: Transporter;

  private readonly from: string;

  private readonly logger: Logger;

  constructor(config: AppConfig, logger: Logger) {
    this.logger = logger;
    this.from = config.SMTP_FROM;

    const auth =
      config.SMTP_USERNAME && config.SMTP_PASSWORD
        ? {
            user: config.SMTP_USERNAME,
            pass: config.SMTP_PASSWORD,
          }
        : undefined;

    this.transporter = createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth,
      tls: {
        rejectUnauthorized: config.SMTP_TLS_REJECT_UNAUTHORIZED,
      },
      // MailHog için SSL/TLS devre dışı
      ignoreTLS: !config.SMTP_SECURE,
    });
  }

  /**
   * SMTP bağlantısını test et
   */
  async verifyConnection(): Promise<boolean> {
    try {
      await this.transporter.verify();
      this.logger.info('Email service connection verified');
      return true;
    } catch (error) {
      this.logger.error({ error }, 'Email service verification failed');
      return false;
    }
  }

  /**
   * Email gönder (eski method - backward compatibility)
   */
  async sendEmail(options: SendEmailOptions): Promise<void> {
    if (options.to.length === 0) {
      this.logger.debug('Skipping email send because recipient list is empty');
      return;
    }

    try {
      await this.transporter.sendMail({
        from: this.from,
        to: options.to,
        cc: options.cc,
        bcc: options.bcc,
        subject: options.subject,
        text: options.text,
        html: options.html,
        attachments: options.attachments,
      });
      this.logger.info(
        { to: options.to, cc: options.cc, bcc: options.bcc, subject: options.subject },
        'Email sent successfully',
      );
    } catch (error: unknown) {
      this.logger.error({ error, options }, 'Failed to send email');
      // Test ortamında email hatası uygulamayı çökertmesin
      if (process.env.NODE_ENV === 'test') {
        this.logger.warn('Email sending failed in test environment, continuing...');
        return;
      }
      throw error;
    }
  }

  /**
   * Email gönder (yeni method - result döner)
   */
  async send(options: SendEmailOptions): Promise<EmailResult> {
    if (options.to.length === 0) {
      this.logger.debug('Skipping email send because recipient list is empty');
      return {
        success: true,
        messageId: `empty-${Date.now()}`,
        recipients: [],
      };
    }

    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to: options.to,
        cc: options.cc,
        bcc: options.bcc,
        subject: options.subject,
        text: options.text,
        html: options.html,
        attachments: options.attachments,
      });

      this.logger.info(
        {
          messageId: info.messageId,
          recipients: options.to,
          cc: options.cc,
          bcc: options.bcc,
          subject: options.subject,
        },
        'Email sent successfully'
      );

      // Log email to database (her alıcı için ayrı log)
      for (const recipient of options.to) {
        await unsubscribeService.logEmail({
          recipientEmail: recipient,
          recipientUserId: options.userId,
          subject: options.subject,
          templateName: options.templateName || 'custom',
          notificationType: options.notificationType || 'system',
          deliveryStatus: 'sent',
          messageId: info.messageId,
        }).catch((logError) => {
          // Log hatası email göndermini engellemez
          this.logger.warn({ error: logError, messageId: info.messageId }, 'Failed to log email');
        });
      }

      return {
        success: true,
        messageId: info.messageId,
        recipients: options.to,
      };
    } catch (error: unknown) {
      this.logger.error({ error, options }, 'Failed to send email');

      // Log failed email attempts (her alıcı için ayrı log)
      for (const recipient of options.to) {
        await unsubscribeService.logEmail({
          recipientEmail: recipient,
          recipientUserId: options.userId,
          subject: options.subject,
          templateName: options.templateName || 'custom',
          notificationType: options.notificationType || 'system',
          deliveryStatus: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        }).catch((logError) => {
          this.logger.warn({ error: logError }, 'Failed to log email error');
        });
      }

      // Test ortamında exception atma
      if (process.env.NODE_ENV === 'test') {
        this.logger.warn('Email sending failed in test environment, continuing...');
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          recipients: options.to,
        };
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        recipients: options.to,
      };
    }
  }

  /**
   * Template kullanarak email gönder
   */
  async sendTemplateEmail(options: TemplateEmailOptions): Promise<EmailResult> {
    try {
      // Template'i render et
      const rendered = await emailTemplateService.renderEmail(
        options.template,
        options.data
      );

      // Email gönder (metadata ile)
      return await this.send({
        to: options.to,
        cc: options.cc,
        bcc: options.bcc,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text || '',
        attachments: options.attachments,
        userId: options.userId,
        templateName: options.template,
        notificationType: options.notificationType || 'template',
      });
    } catch (error) {
      this.logger.error(
        {
          error,
          template: options.template,
          recipients: options.to,
        },
        'Failed to send template email'
      );

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        recipients: options.to,
      };
    }
  }

  /**
   * Batch email gönder (aynı template, farklı alıcılar)
   */
  async sendBatchTemplateEmails(
    template: string,
    recipients: Array<{
      to: string[];
      cc?: string[];
      bcc?: string[];
      data: Record<string, any>;
    }>
  ): Promise<EmailResult[]> {
    const results: EmailResult[] = [];

    // Template'leri toplu render et (performans)
    const renderedTemplates = await emailTemplateService.renderBatch(
      template,
      recipients.map((r) => r.data)
    );

    // Her alıcıya gönder
    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i];
      const rendered = renderedTemplates[i];

      const result = await this.send({
        to: recipient.to,
        cc: recipient.cc,
        bcc: recipient.bcc,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text || '',
      });

      results.push(result);

      // Rate limiting (çok hızlı gönderme)
      if (i < recipients.length - 1) {
        await this.delay(100); // 100ms bekle
      }
    }

    const successCount = results.filter((r) => r.success).length;
    this.logger.info(
      {
        template,
        total: recipients.length,
        success: successCount,
        failed: recipients.length - successCount,
      },
      'Batch email sending completed'
    );

    return results;
  }

  /**
   * Delay helper (rate limiting için)
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Transporter'ı kapat (graceful shutdown için)
   */
  async close(): Promise<void> {
    if (this.transporter) {
      this.transporter.close();
      this.logger.info('Email service closed');
    }
  }
}
