import { createTransport, type Transporter } from 'nodemailer';
import type { Logger } from '../../lib/logger';
import type { AppConfig } from '../../config/app-config';

export interface SendEmailOptions {
  to: string[];
  subject: string;
  text: string;
  html?: string;
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

  async sendEmail(options: SendEmailOptions): Promise<void> {
    if (options.to.length === 0) {
      this.logger.debug('Skipping email send because recipient list is empty');
      return;
    }

    try {
      await this.transporter.sendMail({
        from: this.from,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
      });
      this.logger.info(
        { to: options.to, subject: options.subject },
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
}
